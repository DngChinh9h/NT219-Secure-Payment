'use strict';
const paymentService = require('./paymentService');
const auditService   = require('../transactions/auditService');
const { validateNonce } = require('../crypto');
const { checkVelocity, recordFailure } = require('./velocityCheck');

async function createPaymentIntent(req, res) {
  const {
    orderId,
    provider,
    paymentToken,
    stripeToken,
    amount,
    nonce,
    timestamp,
  } = req.body;

  // 1. Nonce / anti-replay check
  const nonceCheck = validateNonce(nonce, timestamp);
  if (!nonceCheck.valid) {
    await auditService.log({
      eventType: 'PAYMENT_REPLAY_DETECTED',
      userId:    req.user.userId,
      ipAddress: req.ip,
      payload:   { reason: nonceCheck.reason }
    });
    return res.status(400).json({ error: nonceCheck.reason });
  }

  // 2. Velocity check — block after too many failures
  const velocity = checkVelocity(req.user.userId);
  if (velocity.blocked) {
    await auditService.log({
      eventType: 'VELOCITY_BLOCK',
      userId:    req.user.userId,
      ipAddress: req.ip,
      payload:   { reason: velocity.reason }
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
      userId: req.user.userId
    });

    await auditService.log({
      eventType: 'PAYMENT_ATTEMPT',
      userId:    req.user.userId,
      ipAddress: req.ip,
      payload:   {
        orderId,
        provider: result.provider,
        paymentIntentId: result.paymentIntentId
      }
    });
    await auditService.log({
      eventType: 'payment_intent_created',
      userId:    req.user.userId,
      ipAddress: req.ip,
      payload:   {
        orderId,
        provider: result.provider,
        paymentIntentId: result.paymentIntentId,
        status: result.status
      }
    });

    return res.status(200).json(result);
  } catch (err) {
    // Record failure for velocity tracking
    recordFailure(req.user.userId);

    await auditService.log({
      eventType: 'PAYMENT_FAIL',
      userId:    req.user?.userId,
      ipAddress: req.ip,
      payload:   { error: err.message, orderId }
    });
    await auditService.log({
      eventType: 'payment_failed',
      userId:    req.user?.userId,
      ipAddress: req.ip,
      payload:   { error: err.message, orderId }
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
      role: req.user.role
    });

    await auditService.log({
      eventType: 'payment_synced',
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: {
        paymentIntentId: req.params.paymentIntentId,
        providerStatus: result.providerStatus,
        orderStatus: result.orderStatus
      }
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message });
  }
}

async function refundPayment(req, res) {
  try {
    const { transactionId, reason } = req.body || {};

    if (!transactionId || !reason) {
      return res.status(400).json({ error: "transactionId and reason are required" });
    }

    const result = await paymentService.refundTransaction({
      transactionId,
      reason,
      userId: req.user.userId,
      role: req.user.role
    });

    await auditService.log({
      eventType:
        result.providerStatus === 'succeeded'
          ? 'refund_processed'
          : `refund_provider_${result.providerStatus}`,
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: {
        transactionId,
        refundId: result.refundId,
        reason,
        providerStatus: result.providerStatus
      }
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message });
  }
}

module.exports = { createPaymentIntent, syncPayment, refundPayment };
