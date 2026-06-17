"use strict";

const db = require("../db");

function toNumber(value) {
  return Number(value || 0);
}

function getPositiveIntegerEnv(name, fallback, env = process.env) {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function getRiskEvidence({ database = db, env = process.env } = {}) {
  const failedPaymentThreshold = getPositiveIntegerEnv(
    "RISK_FAILED_PAYMENT_THRESHOLD",
    3,
    env,
  );
  const refundRequestThreshold = getPositiveIntegerEnv(
    "RISK_REFUND_REQUEST_THRESHOLD",
    3,
    env,
  );
  const highAmountThreshold = getPositiveIntegerEnv(
    "RISK_HIGH_AMOUNT_THRESHOLD",
    10_000_000,
    env,
  );
  const [
    repeatedFailedPayments,
    manyRefundRequests,
    duplicatePaymentAttempts,
    duplicateRefundAttempts,
    replayAttempts,
    highAmountOrders,
    providerFailures,
  ] = await Promise.all([
    database.query(
      `SELECT COALESCE(a.actor_user_id, a.user_id) AS user_id,
              u.email, COUNT(*)::BIGINT AS occurrence_count
       FROM audit_logs a
       LEFT JOIN users u ON u.id = COALESCE(a.actor_user_id, a.user_id)
       WHERE a.event_type = 'payment_failed'
       GROUP BY COALESCE(a.actor_user_id, a.user_id), u.email
       HAVING COUNT(*) >= $1
       ORDER BY occurrence_count DESC
       LIMIT 20`,
      [failedPaymentThreshold],
    ),
    database.query(
      `SELECT rr.user_id, u.email, COUNT(*)::BIGINT AS occurrence_count
       FROM refund_requests rr
       LEFT JOIN users u ON u.id = rr.user_id
       GROUP BY rr.user_id, u.email
       HAVING COUNT(*) >= $1
       ORDER BY occurrence_count DESC
       LIMIT 20`,
      [refundRequestThreshold],
    ),
    database.query(
      `SELECT COUNT(*)::BIGINT AS occurrence_count
       FROM audit_logs
       WHERE event_type = 'payment_failed'
         AND COALESCE(metadata, payload)->>'error'
             ILIKE '%already being processed or not available%'`,
    ),
    database.query(
      `SELECT COUNT(*)::BIGINT AS occurrence_count
       FROM audit_logs
       WHERE event_type IN ('refund_request_blocked', 'refund_approval_blocked')`,
    ),
    database.query(
      `SELECT COUNT(*)::BIGINT AS occurrence_count
       FROM audit_logs
       WHERE event_type = 'PAYMENT_REPLAY_DETECTED'`,
    ),
    database.query(
      `SELECT id AS order_id, user_id, total_amount, status
       FROM orders
       WHERE total_amount >= $1
       ORDER BY total_amount DESC
       LIMIT 20`,
      [highAmountThreshold],
    ),
    database.query(
      `SELECT 'refund_request' AS signal_type, id::TEXT AS signal_id,
              id AS refund_request_id, order_id, user_id, provider,
              provider_status, provider_error IS NOT NULL AS provider_error_present,
              updated_at AS signal_at
       FROM refund_requests
       WHERE status = 'provider_failed'
          OR provider_status = 'failed'
       UNION ALL
       SELECT 'payment_order', o.id::TEXT, NULL::UUID, o.id, o.user_id,
              o.payment_provider, 'failed', FALSE, o.updated_at
       FROM orders o
       WHERE o.status = 'payment_failed'
       ORDER BY signal_at DESC
       LIMIT 20`,
    ),
  ]);
  const repeatedFailedPaymentUsers = repeatedFailedPayments.rows.map((row) => ({
    userId: row.user_id || null,
    email: row.email || null,
    occurrenceCount: toNumber(row.occurrence_count),
  }));
  const frequentRefundUsers = manyRefundRequests.rows.map((row) => ({
    userId: row.user_id,
    email: row.email || null,
    occurrenceCount: toNumber(row.occurrence_count),
  }));
  const highAmountOrderSignals = highAmountOrders.rows.map((row) => ({
    orderId: row.order_id,
    userId: row.user_id,
    totalAmount: toNumber(row.total_amount),
    status: row.status,
  }));
  const providerFailureSignals = providerFailures.rows.map((row) => ({
    signalType: row.signal_type,
    signalId: row.signal_id,
    refundRequestId: row.refund_request_id || null,
    orderId: row.order_id,
    userId: row.user_id,
    provider: row.provider || null,
    providerStatus: row.provider_status || null,
    providerErrorPresent: row.provider_error_present,
  }));
  const duplicatePaymentAttemptsBlocked = toNumber(
    duplicatePaymentAttempts.rows[0]?.occurrence_count,
  );
  const duplicateRefundAttemptsBlocked = toNumber(
    duplicateRefundAttempts.rows[0]?.occurrence_count,
  );
  const replayAttemptsBlocked = toNumber(
    replayAttempts.rows[0]?.occurrence_count,
  );
  const triggeredRules = [
    repeatedFailedPaymentUsers.length > 0,
    frequentRefundUsers.length > 0,
    duplicatePaymentAttemptsBlocked > 0,
    duplicateRefundAttemptsBlocked > 0,
    replayAttemptsBlocked > 0,
    highAmountOrderSignals.length > 0,
    providerFailureSignals.length > 0,
  ].filter(Boolean).length;

  return {
    status: triggeredRules > 0 ? "review" : "clear",
    triggeredRules,
    checkedAt: new Date().toISOString(),
    rules: {
      repeatedFailedPayments: {
        enabled: true,
        threshold: failedPaymentThreshold,
        flaggedUsers: repeatedFailedPaymentUsers,
      },
      manyRefundRequests: {
        enabled: true,
        threshold: refundRequestThreshold,
        flaggedUsers: frequentRefundUsers,
      },
      duplicatePaymentAttemptsBlocked: {
        enabled: true,
        observedCount: duplicatePaymentAttemptsBlocked,
      },
      duplicateRefundAttemptsBlocked: {
        enabled: true,
        observedCount: duplicateRefundAttemptsBlocked,
      },
      replayAttemptsBlocked: {
        enabled: true,
        observedCount: replayAttemptsBlocked,
      },
      highAmountOrders: {
        enabled: true,
        threshold: highAmountThreshold,
        observedCount: highAmountOrderSignals.length,
        orders: highAmountOrderSignals,
      },
      suspiciousProviderFailures: {
        enabled: true,
        observedCount: providerFailureSignals.length,
        refundRequests: providerFailureSignals,
      },
    },
  };
}

module.exports = {
  getPositiveIntegerEnv,
  getRiskEvidence,
  toNumber,
};
