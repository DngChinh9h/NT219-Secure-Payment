'use strict';
const express = require('express');
const router  = express.Router();
const { authenticate }   = require('../gateway/authMiddleware');
const { requireAdmin } = require('../gateway/authzMiddleware');
const { validate, paymentSchema } = require('../crypto');
const {
  adminRefundLimiter,
  paymentCreateIntentLimiter,
} = require('../gateway/rateLimiter');
const { createPaymentIntent, syncPayment, refundPayment } = require('./paymentController');

router.post(
  '/create-intent',
  paymentCreateIntentLimiter,
  authenticate,
  validate(paymentSchema),
  createPaymentIntent
);

router.post('/sync/:paymentIntentId', authenticate, syncPayment);
router.post('/refund', adminRefundLimiter, authenticate, requireAdmin, refundPayment);

module.exports = router;
