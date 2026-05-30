'use strict';
const express = require('express');
const router  = express.Router();
const { authenticate }   = require('../gateway/authMiddleware');
const { validate, paymentSchema } = require('../crypto');
const { createPaymentIntent, syncPayment } = require('./paymentController');

router.post(
  '/create-intent',
  authenticate,
  validate(paymentSchema),
  createPaymentIntent
);

router.post('/sync/:paymentIntentId', authenticate, syncPayment);

module.exports = router;
