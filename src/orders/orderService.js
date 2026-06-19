"use strict";

const crypto = require("crypto");
const db = require("../db");
const { computeMac } = require("../crypto");
const { assertTransition } = require("./orderStateMachine");

function createError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function hashOrderItems(items) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(items))
    .digest("hex");
}

function normalizeRequestedItems(items) {
  const merged = new Map();

  for (const item of items || []) {
    const quantity = Number(item.quantity);
    if (!item.productId || !Number.isInteger(quantity) || quantity <= 0) {
      throw createError("Invalid order item quantity", 400);
    }
    const current = merged.get(item.productId) || 0;
    merged.set(item.productId, current + quantity);
  }

  return [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

async function loadActiveProducts(productIds, queryable = db) {
  const result = await queryable.query(
    `SELECT p.id, p.merchant_id, p.name, p.price, p.currency, p.active
     FROM products p
     WHERE p.id = ANY($1::uuid[])
       AND p.active = TRUE`,
    [productIds],
  );

  return new Map(result.rows.map((row) => [row.id, row]));
}

function buildPricedItems(requestedItems, productsById) {
  const pricedItems = [];
  let merchantId = null;
  let currency = null;

  for (const requested of requestedItems) {
    const product = productsById.get(requested.productId);
    if (!product) {
      throw createError(`Product not found or inactive: ${requested.productId}`, 400);
    }

    if (merchantId && merchantId !== product.merchant_id) {
      throw createError("Order may contain products from one merchant only", 400);
    }
    if (currency && currency !== product.currency) {
      throw createError("Order may contain one currency only", 400);
    }

    merchantId = product.merchant_id;
    currency = product.currency;

    const unitPrice = Number(product.price);
    const lineTotal = unitPrice * requested.quantity;
    pricedItems.push({
      productId: product.id,
      merchantId: product.merchant_id,
      productName: product.name,
      quantity: requested.quantity,
      unitPrice,
      currency: product.currency,
      lineTotal,
    });
  }

  return {
    merchantId,
    currency,
    pricedItems,
    totalAmount: pricedItems.reduce((sum, item) => sum + item.lineTotal, 0),
  };
}

async function createOrder({ userId, items, shippingAddress }) {
  const requestedItems = normalizeRequestedItems(items);
  if (requestedItems.length === 0) {
    throw createError("Order must have at least one item", 400);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const productsById = await loadActiveProducts(
      requestedItems.map((item) => item.productId),
      client,
    );
    const {
      merchantId,
      currency,
      pricedItems,
      totalAmount,
    } = buildPricedItems(requestedItems, productsById);
    const orderItemsHash = hashOrderItems(
      pricedItems.map((item) => ({
        product_id: item.productId,
        merchant_id: item.merchantId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        currency: item.currency,
        line_total: item.lineTotal,
      })),
    );

    const orderResult = await client.query(
      `INSERT INTO orders
        (user_id, merchant_id, total_amount, currency, shipping_address,
         status, order_items_hash)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [userId, merchantId, totalAmount, currency, shippingAddress, orderItemsHash],
    );
    const order = orderResult.rows[0];

    for (const item of pricedItems) {
      await client.query(
        `INSERT INTO order_items
          (order_id, merchant_id, product_id, product_name, quantity,
           unit_price, currency, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.id,
          item.merchantId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
          item.currency,
          item.lineTotal,
        ],
      );
    }

    const mac = computeMac({
      orderId: order.id,
      userId,
      merchantId,
      totalAmount,
      currency,
      orderItemsHash,
      createdAt: order.created_at,
    });
    await client.query("UPDATE orders SET hmac_signature = $1 WHERE id = $2", [
      mac,
      order.id,
    ]);

    await client.query("COMMIT");
    return {
      ...order,
      total_amount: totalAmount,
      currency,
      merchant_id: merchantId,
      order_items_hash: orderItemsHash,
      hmac_signature: mac,
      items: pricedItems,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getOrderById(orderId) {
  const result = await db.query(
    `SELECT o.*, m.user_id AS merchant_user_id,
            COALESCE(json_agg(oi ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
     FROM orders o
     LEFT JOIN merchants m ON m.id = o.merchant_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = $1
     GROUP BY o.id, m.user_id
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] || null;
}

async function getOrdersByUserId(userId) {
  const result = await db.query(
    `SELECT o.*, m.display_name AS merchant_name,
            COALESCE(json_agg(oi ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
     FROM orders o
     JOIN merchants m ON m.id = o.merchant_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = $1
     GROUP BY o.id, m.display_name
     ORDER BY o.created_at DESC`,
    [userId],
  );
  return result.rows;
}

async function getOrdersForMerchantUser({ userId, role }) {
  const params = [];
  let where = "";

  if (role !== "admin") {
    params.push(userId);
    where = "WHERE m.user_id = $1";
  }

  const result = await db.query(
    `SELECT o.*, u.email AS customer_email, m.display_name AS merchant_name,
            COALESCE(json_agg(oi ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
     FROM orders o
     JOIN merchants m ON m.id = o.merchant_id
     JOIN users u ON u.id = o.user_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     ${where}
     GROUP BY o.id, u.email, m.display_name
     ORDER BY o.created_at DESC
     LIMIT 200`,
    params,
  );
  return result.rows;
}

async function updateOrderStatus(
  orderId,
  status,
  providerPaymentId = null,
  queryable = db,
) {
  const orderResult = await queryable.query(
    "SELECT status, stripe_payment_intent_id FROM orders WHERE id = $1 LIMIT 1",
    [orderId],
  );

  const currentOrder = orderResult.rows[0];
  if (!currentOrder) return null;

  assertTransition(currentOrder.status, status);

  const nextProviderPaymentId =
    providerPaymentId || currentOrder.stripe_payment_intent_id || null;

  const result = await queryable.query(
    `UPDATE orders
     SET status = $1, stripe_payment_intent_id = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, nextProviderPaymentId, orderId],
  );
  return result.rows[0];
}

module.exports = {
  buildPricedItems,
  createOrder,
  getOrderById,
  getOrdersByUserId,
  getOrdersForMerchantUser,
  hashOrderItems,
  loadActiveProducts,
  updateOrderStatus,
};
