"use strict";

require("dotenv").config();

const crypto = require("crypto");
const db = require("../db");
const orderService = require("../orders/orderService");
const { computeMac, createSignedReceipt } = require("../crypto");
const { getProvider } = require("./providers/providerRegistry");

function createError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeCurrency(currency) {
  return String(currency || "vnd").toLowerCase();
}

function providerPaymentIdFromTransaction(tx) {
  return tx.provider_payment_id || tx.stripe_payment_id;
}

function getProviderNameForOrder(order, paymentIntentId = "") {
  return order.payment_provider || (paymentIntentId.startsWith("mock_pi_") ? "mock_bank" : "stripe");
}

function getProviderNameForTransaction(tx) {
  return tx.provider || (tx.stripe_payment_id?.startsWith("mock_pi_") ? "mock_bank" : "stripe");
}

function sanitizeProviderResponse(payment) {
  const raw = payment?.raw || {};
  return {
    id: payment.providerPaymentId || raw.id || null,
    provider: payment.provider,
    status: payment.status || raw.status || null,
    amount: raw.amount ?? raw.amount_received ?? null,
    currency: raw.currency || null,
    metadata: raw.metadata || null,
  };
}

function assertAmountMatches({ providedAmount, orderAmount }) {
  if (providedAmount !== undefined && Number(providedAmount) !== Number(orderAmount)) {
    throw createError("Payment amount does not match order total", 400);
  }
}

async function getOrderForPaymentAttempt({ orderId, userId, queryable = db }) {
  const result = await queryable.query(
    `SELECT o.*, m.user_id AS merchant_user_id
     FROM orders o
     JOIN merchants m ON m.id = o.merchant_id
     WHERE o.id = $1
     LIMIT 1`,
    [orderId],
  );
  const order = result.rows[0];

  if (!order) throw createError("Order not found", 404);
  if (order.user_id !== userId) {
    throw createError("Forbidden: order belongs to another user", 403);
  }

  return order;
}

function assertOrderCanCreatePayment(order) {
  if (!["pending", "payment_failed", "processing"].includes(order.status)) {
    throw createError(
      `Order is not available for payment. Current status: ${order.status}`,
      409,
    );
  }
}

async function claimPaymentAttempt({
  order,
  provider,
  idempotencyKey,
  queryable,
}) {
  const insertResult = await queryable.query(
    `INSERT INTO payment_attempts
      (order_id, payer_user_id, merchant_id, provider, amount, currency,
       idempotency_key, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'created')
     ON CONFLICT (payer_user_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      order.id,
      order.user_id,
      order.merchant_id,
      provider,
      order.total_amount,
      order.currency,
      idempotencyKey,
    ],
  );

  if (insertResult.rowCount > 0) {
    return { attempt: insertResult.rows[0], reused: false };
  }

  const existingResult = await queryable.query(
    `SELECT *
     FROM payment_attempts
     WHERE payer_user_id = $1
       AND idempotency_key = $2
     LIMIT 1`,
    [order.user_id, idempotencyKey],
  );
  const attempt = existingResult.rows[0];

  if (!attempt) {
    throw createError("Payment idempotency lookup failed", 409);
  }

  if (
    attempt.order_id !== order.id ||
    attempt.provider !== provider ||
    Number(attempt.amount) !== Number(order.total_amount) ||
    normalizeCurrency(attempt.currency) !== normalizeCurrency(order.currency)
  ) {
    throw createError("Idempotency key was used for a different payment", 409);
  }

  return { attempt, reused: true };
}

function mapAttemptResponse(attempt) {
  return {
    clientSecret: attempt.client_secret || null,
    paymentIntentId: attempt.provider_payment_id,
    provider: attempt.provider,
    providerPaymentId: attempt.provider_payment_id,
    status: attempt.status,
    paymentAttemptId: attempt.id,
    amount: Number(attempt.amount),
    currency: attempt.currency,
    idempotent: true,
  };
}

async function updateOrderProcessing({ order, provider, providerPaymentId = null, queryable }) {
  const result = await queryable.query(
    `UPDATE orders
     SET status = 'processing',
         payment_provider = $2,
         stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id),
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('pending', 'payment_failed', 'processing')
     RETURNING *`,
    [order.id, provider, providerPaymentId],
  );

  if (result.rowCount === 0) {
    throw createError(
      `Order is already being processed or not available. Current status: ${order.status}`,
      409,
    );
  }

  return {
    ...order,
    ...result.rows[0],
    merchant_user_id: order.merchant_user_id,
  };
}

async function persistProviderPayment({ attemptId, payment }) {
  const result = await db.query(
    `UPDATE payment_attempts
     SET provider_payment_id = $2,
         status = $3,
         raw_provider_response = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      attemptId,
      payment.providerPaymentId,
      payment.status,
      JSON.stringify(sanitizeProviderResponse(payment)),
    ],
  );

  return result.rows[0];
}

async function attachProviderPaymentToOrder({ orderId, provider, providerPaymentId }) {
  await db.query(
    `UPDATE orders
     SET stripe_payment_intent_id = $1,
         payment_provider = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [providerPaymentId, provider, orderId],
  );
}

async function markAttemptStatus({ attemptId, status, queryable = db }) {
  const result = await queryable.query(
    `UPDATE payment_attempts
     SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [attemptId, status],
  );
  return result.rows[0] || null;
}

async function createPaymentIntent({
  orderId,
  stripeToken,
  paymentToken,
  provider = "stripe",
  amount,
  userId,
  idempotencyKey,
}) {
  const providerName = provider || "stripe";
  const providerModule = getProvider(providerName);
  const paymentMethodToken =
    providerName === "stripe" ? paymentToken || stripeToken : paymentToken;
  const effectiveIdempotencyKey = idempotencyKey || crypto.randomUUID();

  let order;
  let attempt;
  let reused = false;
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    order = await getOrderForPaymentAttempt({ orderId, userId, queryable: client });
    assertOrderCanCreatePayment(order);
    assertAmountMatches({ providedAmount: amount, orderAmount: order.total_amount });

    const claim = await claimPaymentAttempt({
      order,
      provider: providerName,
      idempotencyKey: effectiveIdempotencyKey,
      queryable: client,
    });
    attempt = claim.attempt;
    reused = claim.reused;

    if (reused && attempt.provider_payment_id) {
      await client.query("COMMIT");
      return mapAttemptResponse(attempt);
    }

    order = await updateOrderProcessing({
      order,
      provider: providerName,
      queryable: client,
    });
    await client.query("COMMIT");
  } catch (err) {
    await Promise.resolve(client.query("ROLLBACK")).catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  try {
    const payment = await providerModule.createPayment({
      order,
      paymentMethodToken,
      idempotencyKey: effectiveIdempotencyKey,
    });

    const updatedAttempt = await persistProviderPayment({
      attemptId: attempt.id,
      payment,
    });
    await attachProviderPaymentToOrder({
      orderId: order.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
    });

    if (payment.provider === "mock_bank") {
      if (payment.status === "succeeded") {
        const tx = await confirmPayment(payment.providerPaymentId, null, {
          provider: payment.provider,
          providerStatus: "succeeded",
          orderId: order.id,
          payerUserId: order.user_id,
          merchantId: order.merchant_id,
          amount: order.total_amount,
          currency: order.currency,
        });
        return {
          clientSecret: payment.clientSecret,
          paymentIntentId: payment.providerPaymentId,
          provider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          status: payment.status,
          paymentAttemptId: updatedAttempt.id,
          amount: Number(updatedAttempt.amount),
          currency: updatedAttempt.currency,
          transaction: tx,
          idempotent: reused,
        };
      }

      if (payment.status === "failed") {
        await markAttemptStatus({ attemptId: attempt.id, status: "failed" });
        await orderService.updateOrderStatus(
          order.id,
          "payment_failed",
          payment.providerPaymentId,
        );
      }
    }

    return {
      clientSecret: payment.clientSecret,
      paymentIntentId: payment.providerPaymentId,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      status: payment.status,
      paymentAttemptId: updatedAttempt.id,
      amount: Number(updatedAttempt.amount),
      currency: updatedAttempt.currency,
      idempotent: reused,
    };
  } catch (err) {
    if (attempt?.id) {
      await markAttemptStatus({ attemptId: attempt.id, status: "failed" }).catch(() => {});
    }
    throw err;
  }
}

async function attachSecurityArtifactsToTransaction({
  tx,
  order,
  provider,
  providerPaymentId,
  last4,
}) {
  let mac = tx.hmac_signature;
  let jws = tx.jws_receipt;
  const receiptId = tx.receipt_id || crypto.randomUUID();
  const orderItemsHash = tx.order_items_hash || order.order_items_hash;

  if (!mac) {
    mac = computeMac({
      txId: tx.id,
      orderId: order.id,
      payerUserId: order.user_id,
      merchantId: order.merchant_id,
      providerPaymentId,
      amount: order.total_amount,
      currency: order.currency,
      orderItemsHash,
      createdAt: tx.created_at,
    });

    await db.query("UPDATE transactions SET hmac_signature = $1 WHERE id = $2", [
      mac,
      tx.id,
    ]);
  }

  if (!jws) {
    jws = await createSignedReceipt({
      receiptId,
      orderId: order.id,
      transactionId: tx.id,
      payerUserId: order.user_id,
      merchantId: order.merchant_id,
      provider,
      providerPaymentId,
      amount: order.total_amount,
      currency: order.currency,
      status: "PAID",
      orderItemsHash,
      last4,
    });

    await db.query(
      `UPDATE transactions
       SET jws_receipt = $1, receipt_id = $2, order_items_hash = $3
       WHERE id = $4`,
      [jws, receiptId, orderItemsHash, tx.id],
    );
  }

  return {
    ...tx,
    hmac_signature: mac,
    jws_receipt: jws,
    receipt_id: receiptId,
    order_items_hash: orderItemsHash,
  };
}

async function createSuccessfulTransaction({
  order,
  provider,
  providerPaymentId,
  last4,
  queryable = db,
}) {
  const txResult = await queryable.query(
    `INSERT INTO transactions
      (order_id, user_id, payer_user_id, merchant_id, stripe_payment_id,
       provider, provider_payment_id, amount, currency, status,
       stripe_token_last4, order_items_hash)
     VALUES ($1, $2, $2, $3, $4, $5, $4, $6, $7, 'success', $8, $9)
     ON CONFLICT (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL
     DO UPDATE SET provider_payment_id = EXCLUDED.provider_payment_id
     RETURNING *`,
    [
      order.id,
      order.user_id,
      order.merchant_id,
      providerPaymentId,
      provider,
      order.total_amount,
      order.currency,
      last4,
      order.order_items_hash,
    ],
  );

  return attachSecurityArtifactsToTransaction({
    tx: txResult.rows[0],
    order,
    provider,
    providerPaymentId,
    last4,
  });
}

async function getPaymentAttemptForProviderPayment({
  provider = "stripe",
  providerPaymentId,
}) {
  const result = await db.query(
    `SELECT pa.*, o.user_id AS order_user_id, o.merchant_id AS order_merchant_id,
            o.total_amount AS order_total_amount, o.currency AS order_currency,
            o.status AS order_status, o.order_items_hash, o.payment_provider,
            o.stripe_payment_intent_id, o.shipping_address, o.created_at AS order_created_at
     FROM payment_attempts pa
     JOIN orders o ON o.id = pa.order_id
     WHERE pa.provider = $1
       AND pa.provider_payment_id = $2
     LIMIT 1`,
    [provider, providerPaymentId],
  );

  return result.rows[0] || null;
}

function assertReconciliation({ attempt, providerPaymentId, details }) {
  if (!attempt) {
    throw createError(`No payment attempt for provider payment: ${providerPaymentId}`, 404);
  }

  const mismatches = [];
  const requiredFields = details.requireFullReconciliation
    ? ["orderId", "payerUserId", "merchantId", "amount", "currency", "providerStatus"]
    : [];
  const expected = {
    providerPaymentId,
    orderId: attempt.order_id,
    payerUserId: attempt.payer_user_id,
    merchantId: attempt.merchant_id,
    amount: Number(attempt.amount),
    currency: normalizeCurrency(attempt.currency),
  };

  for (const field of requiredFields) {
    if (details[field] === undefined || details[field] === null || details[field] === "") {
      mismatches.push(`missing:${field}`);
    }
  }

  if (details.providerStatus && details.providerStatus !== "succeeded") {
    mismatches.push(`providerStatus:${details.providerStatus}`);
  }
  if (details.orderId && details.orderId !== expected.orderId) {
    mismatches.push("orderId");
  }
  if (details.payerUserId && details.payerUserId !== expected.payerUserId) {
    mismatches.push("payerUserId");
  }
  if (details.merchantId && details.merchantId !== expected.merchantId) {
    mismatches.push("merchantId");
  }
  if (details.amount !== undefined && Number(details.amount) !== expected.amount) {
    mismatches.push("amount");
  }
  if (
    details.currency &&
    normalizeCurrency(details.currency) !== expected.currency
  ) {
    mismatches.push("currency");
  }

  if (mismatches.length > 0) {
    throw createError(`Payment reconciliation mismatch: ${mismatches.join(", ")}`, 409);
  }
}

function attemptToOrder(attempt) {
  return {
    id: attempt.order_id,
    user_id: attempt.payer_user_id,
    merchant_id: attempt.merchant_id,
    total_amount: attempt.amount,
    currency: attempt.currency,
    status: attempt.order_status,
    payment_provider: attempt.provider,
    stripe_payment_intent_id: attempt.provider_payment_id,
    order_items_hash: attempt.order_items_hash,
    shipping_address: attempt.shipping_address,
    created_at: attempt.order_created_at,
  };
}

async function confirmPayment(paymentIntentId, last4 = null, details = {}) {
  const provider = details.provider || (paymentIntentId.startsWith("mock_pi_") ? "mock_bank" : "stripe");
  const attempt = await getPaymentAttemptForProviderPayment({
    provider,
    providerPaymentId: paymentIntentId,
  });

  assertReconciliation({
    attempt,
    providerPaymentId: paymentIntentId,
    details: {
      ...details,
      providerStatus: details.providerStatus || "succeeded",
    },
  });

  const order = attemptToOrder(attempt);

  const existingTxResult = await db.query(
    `SELECT *
     FROM transactions
     WHERE provider = $1
       AND provider_payment_id = $2
     LIMIT 1`,
    [provider, paymentIntentId],
  );

  if (existingTxResult.rowCount > 0) {
    if (order.status !== "paid") {
      await orderService.updateOrderStatus(order.id, "paid", paymentIntentId);
    }
    await markAttemptStatus({ attemptId: attempt.id, status: "succeeded" });
    return attachSecurityArtifactsToTransaction({
      tx: existingTxResult.rows[0],
      order,
      provider,
      providerPaymentId: paymentIntentId,
      last4: last4 || existingTxResult.rows[0].stripe_token_last4 || null,
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await markAttemptStatus({ attemptId: attempt.id, status: "succeeded", queryable: client });
    if (order.status !== "paid") {
      await orderService.updateOrderStatus(order.id, "paid", paymentIntentId, client);
    }
    await client.query("COMMIT");
  } catch (err) {
    await Promise.resolve(client.query("ROLLBACK")).catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return createSuccessfulTransaction({
    order,
    provider,
    providerPaymentId: paymentIntentId,
    last4,
  });
}

async function getOrderForPayment(providerPaymentId) {
  const attempt = await getPaymentAttemptForProviderPayment({
    provider: providerPaymentId.startsWith("mock_pi_") ? "mock_bank" : "stripe",
    providerPaymentId,
  });
  return attempt ? attemptToOrder(attempt) : null;
}

async function syncPayment({ paymentIntentId, userId, role }) {
  const order = await getOrderForPayment(paymentIntentId);

  if (!order) throw createError("Order not found", 404);
  if (role !== "admin" && order.user_id !== userId) {
    throw createError("Forbidden: order belongs to another user", 403);
  }

  const providerName = getProviderNameForOrder(order, paymentIntentId);
  const providerModule = getProvider(providerName);
  const providerPayment = await providerModule.retrievePayment(paymentIntentId);
  const providerStatus =
    providerName === "mock_bank" && order.status === "paid"
      ? "succeeded"
      : providerPayment.status;

  let transaction = null;
  let orderStatus = order.status;

  if (providerStatus === "succeeded") {
    transaction = await confirmPayment(paymentIntentId, null, {
      provider: providerName,
      providerStatus,
      amount: providerPayment.raw?.amount_received ?? providerPayment.raw?.amount,
      currency: providerPayment.raw?.currency,
      orderId: providerPayment.raw?.metadata?.orderId,
      payerUserId:
        providerPayment.raw?.metadata?.payerUserId ||
        providerPayment.raw?.metadata?.userId,
      merchantId: providerPayment.raw?.metadata?.merchantId,
    });
    orderStatus = "paid";
  }

  return {
    paymentIntentId,
    provider: providerName,
    providerStatus,
    orderStatus,
    transaction,
  };
}

function getRefundProviderTimeoutMs() {
  const timeoutMs = Number(process.env.REFUND_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
}

async function refundWithTimeout(providerModule, args) {
  const timeoutMs = getRefundProviderTimeoutMs();
  let timeout;

  try {
    return await Promise.race([
      providerModule.refundPayment(args),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          const err = createError(`Refund provider timed out after ${timeoutMs}ms`, 504);
          reject(err);
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function getExistingRefund({ transactionId, requestedBy, idempotencyKey }) {
  const result = await db.query(
    `SELECT *
     FROM refunds
     WHERE requested_by = $1
       AND idempotency_key = $2
     LIMIT 1`,
    [requestedBy, idempotencyKey],
  );
  const refund = result.rows[0];
  if (!refund) return null;
  if (refund.transaction_id !== transactionId) {
    throw createError("Refund idempotency key was used for a different transaction", 409);
  }
  return refund;
}

async function loadRefundableTransaction(transactionId) {
  const result = await db.query(
    `SELECT t.*, o.status AS order_status, o.id AS order_id,
            o.user_id AS order_user_id, o.merchant_id AS order_merchant_id,
            o.currency AS order_currency
     FROM transactions t
     JOIN orders o ON o.id = t.order_id
     WHERE t.id = $1
     LIMIT 1`,
    [transactionId],
  );
  return result.rows[0] || null;
}

function mapRefundResult({ message, refund, transaction }) {
  return {
    message,
    refundId: refund.provider_refund_id || refund.id,
    refundRecordId: refund.id,
    provider: refund.provider,
    providerStatus: refund.provider_status || refund.status,
    providerError: refund.provider_error || null,
    transaction,
    refund,
  };
}

async function persistSuccessfulRefund({
  transactionId,
  refund,
  reason,
  tx,
  providerPaymentId,
}) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const updateResult = await client.query(
      `UPDATE transactions
       SET status = 'refunded',
           refund_id = $1,
           refunded_at = NOW(),
           refund_reason = $2
       WHERE id = $3
         AND status = 'success'
       RETURNING *`,
      [refund.provider_refund_id || refund.id, reason, transactionId],
    );

    if (updateResult.rowCount === 0) {
      throw createError("Transaction already refunded", 409);
    }

    await orderService.updateOrderStatus(
      tx.order_id,
      "refunded",
      providerPaymentId,
      client,
    );
    await client.query("COMMIT");

    return updateResult.rows[0];
  } catch (err) {
    await Promise.resolve(client.query("ROLLBACK")).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function refundTransaction({
  transactionId,
  reason,
  amount,
  userId,
  role,
  idempotencyKey,
  metadata = {},
  mockRefundOutcome,
}) {
  if (role !== "admin") {
    throw createError("Requires role: admin", 403);
  }
  if (!idempotencyKey) {
    throw createError("Refund idempotencyKey is required", 400);
  }

  const existingRefund = await getExistingRefund({
    transactionId,
    requestedBy: userId,
    idempotencyKey,
  });
  if (existingRefund) {
    return mapRefundResult({
      message: "Refund idempotent result",
      refund: existingRefund,
      transaction: null,
    });
  }

  const tx = await loadRefundableTransaction(transactionId);
  if (!tx) throw createError("Transaction not found", 404);
  if (tx.status === "refunded") throw createError("Transaction already refunded", 409);
  if (tx.status !== "success") {
    throw createError(
      `Only successful transactions can be refunded. Current status: ${tx.status}`,
      409,
    );
  }

  const refundAmount = amount === undefined ? Number(tx.amount) : Number(amount);
  if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
    throw createError("Refund amount must be positive", 400);
  }
  if (refundAmount > Number(tx.amount)) {
    throw createError("Refund amount exceeds paid amount", 400);
  }

  const activeRefund = await db.query(
    `SELECT *
     FROM refunds
     WHERE transaction_id = $1
       AND status IN ('processing', 'pending', 'succeeded')
     LIMIT 1`,
    [transactionId],
  );
  if (activeRefund.rowCount > 0) {
    throw createError("Transaction already has a refund", 409);
  }

  const providerName = getProviderNameForTransaction(tx);
  const providerModule = getProvider(providerName);
  const providerPaymentId = providerPaymentIdFromTransaction(tx);

  const insertResult = await db.query(
    `INSERT INTO refunds
      (transaction_id, order_id, payer_user_id, merchant_id, requested_by,
       approved_by, amount, currency, reason, provider, provider_payment_id,
       idempotency_key, status, provider_status)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11,
             'processing', 'processing')
     RETURNING *`,
    [
      transactionId,
      tx.order_id,
      tx.payer_user_id || tx.user_id,
      tx.merchant_id || tx.order_merchant_id,
      userId,
      refundAmount,
      tx.currency || tx.order_currency || "vnd",
      reason,
      providerName,
      providerPaymentId,
      idempotencyKey,
    ],
  );
  let refund = insertResult.rows[0];

  let providerRefund;
  try {
    providerRefund = await refundWithTimeout(providerModule, {
      providerPaymentId,
      amount: refundAmount,
      reason,
      metadata: {
        orderId: tx.order_id,
        transactionId: tx.id,
        payerUserId: tx.payer_user_id || tx.user_id,
        merchantId: tx.merchant_id || tx.order_merchant_id,
        refundId: refund.id,
        ...metadata,
      },
      mockRefundOutcome,
    });
  } catch (err) {
    await db
      .query(
        `UPDATE refunds
         SET status = 'failed',
             provider_status = 'failed',
             provider_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [refund.id, String(err.message || "Provider refund failed").slice(0, 2000)],
      )
      .catch(() => {});
    throw err;
  }

  const nextStatus =
    providerRefund.status === "succeeded"
      ? "succeeded"
      : providerRefund.status === "pending"
        ? "pending"
        : "failed";

  const updateRefund = await db.query(
    `UPDATE refunds
     SET status = $2,
         provider_status = $3,
         provider_refund_id = $4,
         provider_error = $5,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      refund.id,
      nextStatus,
      providerRefund.status,
      providerRefund.refundId,
      providerRefund.providerError || null,
    ],
  );
  refund = updateRefund.rows[0];

  if (nextStatus !== "succeeded") {
    return mapRefundResult({
      message:
        nextStatus === "pending"
          ? "Refund pending provider confirmation"
          : "Refund provider failed",
      refund,
      transaction: tx,
    });
  }

  const transaction = await persistSuccessfulRefund({
    transactionId,
    refund,
    reason,
    tx,
    providerPaymentId,
  });

  return mapRefundResult({
    message: "Refund processed",
    refund,
    transaction,
  });
}

module.exports = {
  assertReconciliation,
  createPaymentIntent,
  confirmPayment,
  refundTransaction,
  syncPayment,
};
