'use strict';
const paymentService = require('./paymentService');
const auditService   = require('../transactions/auditService');
const { validateNonce } = require('../crypto');
const { checkVelocity, recordFailure } = require('./velocityCheck');

async function createPaymentIntent(req, res) {
  const { orderId, stripeToken, amount, nonce, timestamp } = req.body;

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
      stripeToken,
      amount,
      userId: req.user.userId
    });

    await auditService.log({
      eventType: 'PAYMENT_ATTEMPT',
      userId:    req.user.userId,
      ipAddress: req.ip,
      payload:   { orderId, paymentIntentId: result.paymentIntentId }
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

    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message });
  }
}

module.exports = { createPaymentIntent };