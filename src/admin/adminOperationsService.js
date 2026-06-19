"use strict";

const db = require("../db");

function toNumber(value) {
  return Number(value ?? 0);
}

function mapOrder(row) {
  return {
    id: row.id,
    customerEmail: row.customer_email,
    totalAmount: toNumber(row.total_amount),
    amount: toNumber(row.total_amount),
    status: row.status,
    provider: row.provider || null,
    merchantId: row.merchant_id || null,
    merchantName: row.merchant_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transactionCount: toNumber(row.transaction_count),
    refundStatus: row.refund_status || null,
  };
}

function mapTransaction(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    customerEmail: row.customer_email,
    merchantId: row.merchant_id || null,
    merchantName: row.merchant_name || null,
    provider: row.provider || null,
    provider_payment_id: row.provider_payment_id || null,
    amount: toNumber(row.amount),
    status: row.status,
    refund_id: row.refund_id || null,
    refunded_at: row.refunded_at || null,
    createdAt: row.created_at,
  };
}

function mapProviderEvent(row) {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    providerEventId: row.provider_event_id,
    relatedPaymentIntentId: row.provider_payment_id || null,
    status: row.processing_status,
    receivedAt: row.received_at,
    processedAt: row.processed_at || null,
  };
}

async function getOrders() {
  const result = await db.query(
    `SELECT o.id, u.email AS customer_email, o.total_amount, o.status,
            o.payment_provider AS provider, o.merchant_id, m.display_name AS merchant_name,
            o.created_at, o.updated_at,
            COUNT(DISTINCT t.id)::INTEGER AS transaction_count,
            latest_refund.status AS refund_status
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN merchants m ON m.id = o.merchant_id
     LEFT JOIN transactions t ON t.order_id = o.id
     LEFT JOIN LATERAL (
       SELECT rr.status
       FROM refund_requests rr
       WHERE rr.order_id = o.id
       ORDER BY rr.created_at DESC
       LIMIT 1
     ) latest_refund ON TRUE
     GROUP BY o.id, u.email, m.display_name, latest_refund.status
     ORDER BY o.created_at DESC
     LIMIT 200`,
  );

  return result.rows.map(mapOrder);
}

async function getTransactions() {
  const result = await db.query(
    `SELECT t.id, t.order_id, u.email AS customer_email,
            t.merchant_id, m.display_name AS merchant_name,
            COALESCE(t.provider, o.payment_provider) AS provider,
            COALESCE(t.provider_payment_id, t.stripe_payment_id) AS provider_payment_id,
            t.amount, t.status, t.refund_id, t.refunded_at, t.created_at
     FROM transactions t
     JOIN users u ON u.id = t.payer_user_id
     JOIN orders o ON o.id = t.order_id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     ORDER BY t.created_at DESC
     LIMIT 200`,
  );

  return result.rows.map(mapTransaction);
}

async function getProviderEvents() {
  try {
    const result = await db.query(
      `SELECT id, provider, event_type, provider_event_id,
              provider_payment_id, processing_status, received_at, processed_at
       FROM webhook_events
       ORDER BY received_at DESC
       LIMIT 200`,
    );

    return { items: result.rows.map(mapProviderEvent) };
  } catch (err) {
    if (err?.code === "42P01") {
      return {
        items: [],
        message: "Provider event persistence is not enabled yet",
      };
    }
    throw err;
  }
}

module.exports = {
  getOrders,
  getProviderEvents,
  getTransactions,
};
