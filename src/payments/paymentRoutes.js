'use strict';
const express = require('express');
const router  = express.Router();
const { authenticate }   = require('../gateway/authMiddleware');
const { paymentLimiter } = require('../gateway/rateLimiter');
const { validate, paymentSchema } = require('../crypto');
const { createPaymentIntent } = require('./paymentController');

router.post(
  '/create-intent',
  authenticate,
  paymentLimiter,
  validate(paymentSchema),
  createPaymentIntent
);

module.exports = router;
