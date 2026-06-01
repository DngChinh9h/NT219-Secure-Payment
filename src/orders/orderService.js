"use strict";
const db = require("../db");
const { hmacSign } = require("../crypto");
const { assertTransition } = require("./orderStateMachine");

/**
 * Tạo đơn hàng mới
 * UUID được PostgreSQL tự sinh (gen_random_uuid())
 */
async function createOrder({ userId, items, shippingAddress, totalAmount }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Insert order
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, total_amount, shipping_address, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING *`,
      [userId, totalAmount, shippingAddress],
    );
    const order = orderResult.rows[0];

    // 2. Insert items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5)`,
        [
          order.id,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
        ],
      );
    }

    // 3. HMAC ký order data (integrity)
    const signature = hmacSign({
      orderId: order.id,
      userId,
      totalAmount,
      createdAt: order.created_at,
    });
    await client.query("UPDATE orders SET hmac_signature = $1 WHERE id = $2", [
      signature,
      order.id,
    ]);

    await client.query("COMMIT");
    return { ...order, hmac_signature: signature };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lấy order theo ID — trả về cả user_id để check ownership
 */
async function getOrderById(orderId) {
  const result = await db.query(
    "SELECT * FROM orders WHERE id = $1 LIMIT 1",
    [orderId], // parameterized — fix #5
  );
  return result.rows[0] || null;
}

/**
 * Lấy tất cả orders của 1 user
 */
async function getOrdersByUserId(userId) {
  const result = await db.query(
    `SELECT o.*, json_agg(oi) as items
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE o.user_id = $1
         GROUP BY o.id
         ORDER BY o.created_at DESC`,
    [userId],
  );
  return result.rows;
}

/**
 * Cập nhật status order — chỉ gọi từ Payment Service sau webhook
 */
async function updateOrderStatus(
  orderId,
  status,
  stripePaymentIntentId = null,
  queryable = db,
) {
  const orderResult = await queryable.query(
    "SELECT status, stripe_payment_intent_id FROM orders WHERE id = $1 LIMIT 1",
    [orderId],
  );

  const currentOrder = orderResult.rows[0];
  if (!currentOrder) return null;

  assertTransition(currentOrder.status, status);

  const nextStripePaymentIntentId =
    stripePaymentIntentId || currentOrder.stripe_payment_intent_id || null;

  const result = await queryable.query(
    `UPDATE orders
         SET status = $1, stripe_payment_intent_id = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
    [status, nextStripePaymentIntentId, orderId],
  );
  return result.rows[0];
}

module.exports = {
  createOrder,
  getOrderById,
  getOrdersByUserId,
  updateOrderStatus,
};
