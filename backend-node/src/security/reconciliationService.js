"use strict";

const db = require("../db");

function toNumber(value) {
  return Number(value || 0);
}

async function getReconciliationSummary({ database = db } = {}) {
  const [countsResult, mismatchesResult] = await Promise.all([
    database.query(
      `SELECT
         (SELECT COUNT(*) FROM orders) AS total_orders,
         (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS paid_orders,
         (SELECT COUNT(*) FROM orders WHERE status = 'refunded') AS refunded_orders,
         (SELECT COUNT(*) FROM transactions) AS total_transactions,
         (SELECT COUNT(*) FROM transactions WHERE status = 'success') AS successful_transactions,
         (SELECT COUNT(*) FROM transactions WHERE status = 'refunded') AS refunded_transactions,
         (SELECT COUNT(*) FROM refund_requests) AS refund_requests,
         (SELECT COUNT(*) FROM transactions
          WHERE COALESCE(provider_payment_id, stripe_payment_id) IS NOT NULL) AS provider_linked_payments,
         (SELECT COUNT(*) FROM refund_requests
          WHERE provider_refund_id IS NOT NULL) AS provider_linked_refunds`,
    ),
    database.query(
      `SELECT 'paid_order_without_successful_transaction' AS type,
              o.id AS order_id, NULL::UUID AS transaction_id,
              NULL::UUID AS refund_request_id, 1::BIGINT AS occurrence_count
       FROM orders o
       WHERE o.status = 'paid'
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.order_id = o.id AND t.status = 'success'
         )
       UNION ALL
       SELECT 'successful_transaction_order_not_paid_or_refunded',
              t.order_id, t.id, NULL::UUID, 1::BIGINT
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.status = 'success'
         AND o.status NOT IN ('paid', 'refunded')
       UNION ALL
       SELECT 'succeeded_refund_request_without_provider_refund_id',
              rr.order_id, rr.transaction_id, rr.id, 1::BIGINT
       FROM refund_requests rr
       WHERE rr.status = 'succeeded'
         AND rr.provider_refund_id IS NULL
       UNION ALL
       SELECT 'refunded_order_without_refunded_transaction',
              o.id, NULL::UUID, NULL::UUID, 1::BIGINT
       FROM orders o
       WHERE o.status = 'refunded'
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.order_id = o.id AND t.status = 'refunded'
         )
       UNION ALL
       SELECT 'duplicate_successful_transaction_for_order',
              t.order_id, NULL::UUID, NULL::UUID, COUNT(*)::BIGINT
       FROM transactions t
       WHERE t.status = 'success'
       GROUP BY t.order_id
       HAVING COUNT(*) > 1
       ORDER BY type, order_id`,
    ),
  ]);
  const counts = countsResult.rows[0] || {};
  const mismatches = mismatchesResult.rows.map((row) => ({
    type: row.type,
    orderId: row.order_id || null,
    transactionId: row.transaction_id || null,
    refundRequestId: row.refund_request_id || null,
    occurrenceCount: toNumber(row.occurrence_count),
  }));

  return {
    totalOrders: toNumber(counts.total_orders),
    paidOrders: toNumber(counts.paid_orders),
    refundedOrders: toNumber(counts.refunded_orders),
    totalTransactions: toNumber(counts.total_transactions),
    successfulTransactions: toNumber(counts.successful_transactions),
    refundedTransactions: toNumber(counts.refunded_transactions),
    refundRequests: toNumber(counts.refund_requests),
    providerLinkedPayments: toNumber(counts.provider_linked_payments),
    providerLinkedRefunds: toNumber(counts.provider_linked_refunds),
    status: mismatches.length === 0 ? "ok" : "mismatch_detected",
    mismatchCount: mismatches.length,
    mismatches,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  getReconciliationSummary,
  toNumber,
};
