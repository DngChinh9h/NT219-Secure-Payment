'use strict';
const paymentService = require('./paymentService');
const auditService   = require('../transactions/auditService');
const { validateNonce } = require('../crypto');

async function createPaymentIntent(req, res) {
  const { orderId, stripeToken, amount, nonce, timestamp } = req.body;

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
    await auditService.log({
      eventType: 'PAYMENT_FAIL',
      userId:    req.user?.userId,
      ipAddress: req.ip,
      payload:   { error: err.message, orderId }
    });
    return res.status(400).json({ error: err.message });
  }
}

module.exports = { createPaymentIntent };