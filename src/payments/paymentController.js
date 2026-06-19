"use strict";

const paymentService = require("./paymentService");
const auditService = require("../transactions/auditService");
const { consumeNonce } = require("../security/requestNonceService");
const { checkVelocity, recordFailure } = require("./velocityCheck");

async function createPaymentIntent(req, res) {
  const {
    orderId,
    provider,
    paymentToken,
    stripeToken,
    amount,
    nonce,
    timestamp,
    idempotencyKey,
  } = req.body;

  try {
    await consumeNonce({
      userId: req.user.userId,
      nonce,
      timestamp,
      requestType: "payment_create",
      requestBody: {
        orderId,
        provider: provider || "stripe",
        amount: amount ?? null,
        idempotencyKey: idempotencyKey || null,
      },
    });
  } catch (err) {
    await auditService.log({
      eventType: "payment_replay_detected",
      actorUserId: req.user.userId,
      targetType: "order",
      targetId: orderId || null,
      ipAddress: req.ip,
      metadata: { reason: err.message },
    });
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  const velocity = checkVelocity(req.user.userId);
  if (velocity.blocked) {
    await auditService.log({
      eventType: "velocity_block",
      actorUserId: req.user.userId,
      targetType: "payment",
      ipAddress: req.ip,
      metadata: { reason: velocity.reason },
    });
    return res.status(429).json({ error: velocity.reason });
  }

  try {
    const result = await paymentService.createPaymentIntent({
      orderId,
      provider,
      paymentToken,
      stripeToken,
      amount,
      idempotencyKey: idempotencyKey || nonce,
      userId: req.user.userId,
    });

    await auditService.log({
      eventType: "payment_created",
      actorUserId: req.user.userId,
      targetType: "order",
      targetId: orderId,
      ipAddress: req.ip,
      metadata: {
        provider: result.provider,
        providerPaymentId: result.paymentIntentId,
        paymentAttemptId: result.paymentAttemptId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
      },
    });

    if (result.transaction) {
      await auditService.log({
        eventType: "transaction_success",
        actorUserId: req.user.userId,
        targetType: "transaction",
        targetId: result.transaction.id,
        ipAddress: req.ip,
        metadata: {
          orderId,
          providerPaymentId: result.paymentIntentId,
        },
      });
      await auditService.log({
        eventType: "receipt_issued",
        actorUserId: req.user.userId,
        targetType: "transaction",
        targetId: result.transaction.id,
        ipAddress: req.ip,
        metadata: {
          receiptId: result.transaction.receipt_id,
          merchantId: result.transaction.merchant_id,
        },
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    recordFailure(req.user.userId);

    await auditService.log({
      eventType: "payment_failed",
      actorUserId: req.user?.userId,
      targetType: "order",
      targetId: orderId || null,
      ipAddress: req.ip,
      metadata: { error: err.message },
    });

    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message });
  }
}

async function syncPayment(req, res) {
  try {
    const result = await paymentService.syncPayment({
      paymentIntentId: req.params.paymentIntentId,
      userId: req.user.userId,
      role: req.user.role,
    });

    await auditService.log({
      eventType: "payment_synced",
      actorUserId: req.user.userId,
      targetType: "payment",
      targetId: req.params.paymentIntentId,
      ipAddress: req.ip,
      metadata: {
        providerStatus: result.providerStatus,
        orderStatus: result.orderStatus,
      },
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message });
  }
}

async function refundPayment(req, res) {
  try {
    const {
      transactionId,
      reason,
      amount,
      idempotencyKey,
      mockRefundOutcome,
    } = req.body || {};

    const result = await paymentService.refundTransaction({
      transactionId,
      reason,
      amount,
      idempotencyKey,
      mockRefundOutcome,
      userId: req.user.userId,
      role: req.user.role,
    });

    await auditService.log({
      eventType:
        result.providerStatus === "succeeded"
          ? "refund_approved"
          : "refund_provider_pending_or_failed",
      actorUserId: req.user.userId,
      targetType: "transaction",
      targetId: transactionId,
      ipAddress: req.ip,
      metadata: {
        refundId: result.refundId,
        reason,
        providerStatus: result.providerStatus,
        amount: amount || null,
      },
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message });
  }
}

module.exports = {
  createPaymentIntent,
  refundPayment,
  syncPayment,
};
