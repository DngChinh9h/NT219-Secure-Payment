"use strict";

require("dotenv").config();

const db = require("../db");
const orderService = require("../orders/orderService");
const { hmacSign, createSignedReceipt } = require("../crypto");
const { getProvider } = require("./providers/providerRegistry");

async function lockOrderForPayment({ orderId, userId, provider }) {
  const lockResult = await db.query(
    `UPDATE orders
     SET status = 'processing',
         payment_provider = $3,
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND status = 'pending'
     RETURNING *`,
    [orderId, userId, provider],
  );

  if (lockResult.rowCount > 0) {
    return lockResult.rows[0];
  }

  const orderCheck = await db.query(
    `SELECT id, user_id, status
     FROM orders
     WHERE id = $1
     LIMIT 1`,
    [orderId],
  );

  const existingOrder = orderCheck.rows[0];

  if (!existingOrder) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  if (existingOrder.user_id !== userId) {
    const err = new Error("Forbidden: order belongs to another user");
    err.statusCode = 403;
    throw err;
  }

  const err = new Error(
    `Order is already being processed or not available. Current status: ${existingOrder.status}`,
  );
  err.statusCode = 409;
  throw err;
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

async function rollbackProcessingOrder({ orderId, userId }) {
  await db
    .query(
      `UPDATE orders
       SET status = 'pending',
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status = 'processing'`,
      [orderId, userId],
    )
    .catch(() => {});
}

/**
 * Create a payment for an order.
 *
 * Backward compatibility:
 * - Existing callers can keep sending stripeToken.
 * - provider defaults to stripe.
 * - Response keeps clientSecret/paymentIntentId/status for old clients.
 */
async function createPaymentIntent({
  orderId,
  stripeToken,
  paymentToken,
  provider = "stripe",
  amount,
  userId,
}) {
  const providerName = provider || "stripe";
  const providerModule = getProvider(providerName);
  const paymentMethodToken =
    providerName === "stripe" ? paymentToken || stripeToken : paymentToken;
  let locked = false;

  try {
    const order = await lockOrderForPayment({ orderId, userId, provider: providerName });
    locked = true;

    if (Number(amount) !== Number(order.total_amount)) {
      const err = new Error("Payment amount does not match order total");
      err.statusCode = 400;
      throw err;
    }

    const payment = await providerModule.createPayment({
      order,
      paymentMethodToken,
    });

    await attachProviderPaymentToOrder({
      orderId: order.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
    });

    if (payment.provider === "mock_bank") {
      if (payment.status === "succeeded") {
        await orderService.updateOrderStatus(order.id, "paid", payment.providerPaymentId);
        await createSuccessfulTransaction({
          order,
          provider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          last4: null,
        });
      } else if (payment.status === "failed") {
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
    };
  } catch (err) {
    if (locked) {
      await rollbackProcessingOrder({ orderId, userId });
    }

    throw err;
  }
}

/**
 * Add HMAC signature and JWS receipt to a transaction.
 */
async function attachSecurityArtifactsToTransaction({
  tx,
  order,
  paymentIntentId,
  last4,
}) {
  let signature = tx.hmac_signature;
  let jws = tx.jws_receipt;

  if (!signature) {
    signature = hmacSign({
      txId: tx.id,
      orderId: order.id,
      paymentIntentId,
      amount: order.total_amount,
      createdAt: tx.created_at,
    });

    await db.query("UPDATE transactions SET hmac_signature = $1 WHERE id = $2", [
      signature,
      tx.id,
    ]);
  }

  if (!jws) {
    jws = createSignedReceipt({
      txId: tx.id,
      orderId: order.id,
      userId: order.user_id,
      amount: order.total_amount,
      currency: "vnd",
      last4,
    });

    await db.query("UPDATE transactions SET jws_receipt = $1 WHERE id = $2", [
      jws,
      tx.id,
    ]);
  }

  return {
    ...tx,
    hmac_signature: signature,
    jws_receipt: jws,
  };
}

async function createSuccessfulTransaction({
  order,
  provider,
  providerPaymentId,
  last4,
}) {
  const txResult = await db.query(
    `INSERT INTO transactions
      (order_id, user_id, stripe_payment_id, provider, provider_payment_id,
       amount, currency, status, stripe_token_last4)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL
     DO UPDATE SET stripe_payment_id = EXCLUDED.stripe_payment_id
     RETURNING *`,
    [
      order.id,
      order.user_id,
      providerPaymentId,
      provider,
      providerPaymentId,
      order.total_amount,
      "vnd",
      "success",
      last4,
    ],
  );

  return attachSecurityArtifactsToTransaction({
    tx: txResult.rows[0],
    order,
    paymentIntentId: providerPaymentId,
    last4,
  });
}

function getProviderNameForOrder(order, paymentIntentId) {
  return order.payment_provider || (paymentIntentId.startsWith("mock_pi_") ? "mock_bank" : "stripe");
}

function getMockProviderStatusFromOrder(order, providerStatus) {
  if (order.status === "paid") return "succeeded";
  if (order.status === "payment_failed") return "failed";
  return providerStatus;
}

async function getOrderForPayment(paymentIntentId) {
  const orderResult = await db.query(
    `SELECT *
     FROM orders
     WHERE stripe_payment_intent_id = $1
     LIMIT 1`,
    [paymentIntentId],
  );

  return orderResult.rows[0] || null;
}

/**
 * Handle Stripe payment_intent.succeeded webhook.
 */
async function confirmPayment(paymentIntentId, last4 = null) {
  const order = await getOrderForPayment(paymentIntentId);

  if (!order) {
    const err = new Error(`No order for paymentIntent: ${paymentIntentId}`);
    err.statusCode = 404;
    throw err;
  }

  const existingTxResult = await db.query(
    `SELECT *
     FROM transactions
     WHERE stripe_payment_id = $1
        OR provider_payment_id = $1
     LIMIT 1`,
    [paymentIntentId],
  );

  if (existingTxResult.rowCount > 0) {
    const existingTx = existingTxResult.rows[0];

    if (order.status !== "paid") {
      await orderService.updateOrderStatus(order.id, "paid", paymentIntentId);
    }

    return attachSecurityArtifactsToTransaction({
      tx: existingTx,
      order,
      paymentIntentId,
      last4: last4 || existingTx.stripe_token_last4 || null,
    });
  }

  await orderService.updateOrderStatus(order.id, "paid", paymentIntentId);

  return createSuccessfulTransaction({
    order,
    provider: getProviderNameForOrder(order, paymentIntentId),
    providerPaymentId: paymentIntentId,
    last4,
  });
}

async function syncPayment({ paymentIntentId, userId, role }) {
  const order = await getOrderForPayment(paymentIntentId);

  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  if (role !== "admin" && order.user_id !== userId) {
    const err = new Error("Forbidden: order belongs to another user");
    err.statusCode = 403;
    throw err;
  }

  const providerName = getProviderNameForOrder(order, paymentIntentId);
  const providerModule = getProvider(providerName);
  const providerPayment = await providerModule.retrievePayment(paymentIntentId);
  const providerStatus =
    providerName === "mock_bank"
      ? getMockProviderStatusFromOrder(order, providerPayment.status)
      : providerPayment.status;

  let transaction = null;
  let orderStatus = order.status;

  if (providerStatus === "succeeded") {
    transaction = await confirmPayment(paymentIntentId);
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

function getProviderNameForTransaction(tx) {
  return tx.provider || (tx.stripe_payment_id?.startsWith("mock_pi_") ? "mock_bank" : "stripe");
}

function getProviderPaymentIdForTransaction(tx) {
  return tx.provider_payment_id || tx.stripe_payment_id;
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
          const err = new Error(`Refund provider timed out after ${timeoutMs}ms`);
          err.statusCode = 504;
          reject(err);
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function persistSuccessfulRefund({
  transactionId,
  refundId,
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
      [refundId, reason, transactionId],
    );

    if (updateResult.rowCount === 0) {
      const err = new Error("Transaction already refunded");
      err.statusCode = 409;
      throw err;
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
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function refundTransaction({
  transactionId,
  reason,
  userId,
  role,
  metadata = {},
  mockRefundOutcome,
}) {
  const txResult = await db.query(
    `SELECT t.*, o.status AS order_status, o.id AS order_id, o.user_id AS order_user_id
     FROM transactions t
     JOIN orders o ON o.id = t.order_id
     WHERE t.id = $1
     LIMIT 1`,
    [transactionId],
  );

  const tx = txResult.rows[0];

  if (!tx) {
    const err = new Error("Transaction not found");
    err.statusCode = 404;
    throw err;
  }

  if (role !== "admin" && tx.user_id !== userId) {
    const err = new Error("Forbidden: transaction belongs to another user");
    err.statusCode = 403;
    throw err;
  }

  if (tx.status === "refunded") {
    const err = new Error("Transaction already refunded");
    err.statusCode = 409;
    throw err;
  }

  if (tx.status !== "success") {
    const err = new Error(`Only successful transactions can be refunded. Current status: ${tx.status}`);
    err.statusCode = 409;
    throw err;
  }

  const providerName = getProviderNameForTransaction(tx);
  const providerModule = getProvider(providerName);
  const providerPaymentId = getProviderPaymentIdForTransaction(tx);

  const refund = await refundWithTimeout(providerModule, {
    providerPaymentId,
    amount: tx.amount,
    reason,
    metadata: {
      orderId: tx.order_id,
      transactionId: tx.id,
      userId: tx.user_id,
      ...metadata,
    },
    mockRefundOutcome,
  });

  if (refund.status !== "succeeded") {
    return {
      message:
        refund.status === "pending"
          ? "Refund pending provider confirmation"
          : "Refund provider failed",
      refundId: refund.refundId,
      provider: providerName,
      providerStatus: refund.status,
      providerError: refund.providerError || null,
      transaction: tx,
    };
  }

  const transaction = await persistSuccessfulRefund({
    transactionId,
    refundId: refund.refundId,
    reason,
    tx,
    providerPaymentId,
  });

  return {
    message: "Refund processed",
    refundId: refund.refundId,
    provider: providerName,
    providerStatus: refund.status,
    providerError: null,
    transaction,
  };
}

module.exports = {
  createPaymentIntent,
  confirmPayment,
  syncPayment,
  refundTransaction,
};
