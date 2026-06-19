'use strict';
const express = require('express');
const router  = express.Router();
const { authenticate }   = require('../gateway/authMiddleware');
const { requireAdmin } = require('../gateway/authzMiddleware');
const { validate, paymentSchema, refundPaymentSchema } = require('../crypto');
const {
  adminRefundLimiter,
  paymentCreateIntentLimiter,
} = require('../gateway/rateLimiter');
const { createPaymentIntent, syncPayment, refundPayment } = require('./paymentController');
const { handleWebhook } = require('./webhookHandler');

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook
);

router.post(
  '/create-intent',
  paymentCreateIntentLimiter,
  authenticate,
  validate(paymentSchema),
  createPaymentIntent
);

router.post('/sync/:paymentIntentId', authenticate, syncPayment);
router.post(
  '/refund',
  adminRefundLimiter,
  authenticate,
  requireAdmin,
  validate(refundPaymentSchema),
  refundPayment
);

module.exports = router;
