'use strict';
require('dotenv').config();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db     = require('../db');
const orderService = require('../orders/orderService');
const { hmacSign }  = require('../crypto');

async function createPaymentIntent({ orderId, stripeToken, amount, userId }) {
  const order = await orderService.getOrderById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.user_id !== userId) throw new Error('Forbidden: order belongs to another user');
  if (order.status !== 'pending') throw new Error(`Order status is ${order.status}, expected pending`);

  const paymentIntent = await stripe.paymentIntents.create({
    amount:               amount,
    currency:             'vnd',
    payment_method:       stripeToken,
    confirmation_method:  'manual',
    confirm:              true,
    metadata: {
      orderId:  orderId,
      userId:   userId
    }
  });

  await orderService.updateOrderStatus(
    orderId,
    'processing',
    paymentIntent.id
  );

  return {
    clientSecret:    paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    status:          paymentIntent.status
  };
}

async function confirmPayment(paymentIntentId, last4 = null) {
  const result = await db.query(
    'SELECT * FROM orders WHERE stripe_payment_intent_id = $1',
    [paymentIntentId]
  );
  const order = result.rows[0];
  if (!order) throw new Error(`No order for paymentIntent: ${paymentIntentId}`);

  await orderService.updateOrderStatus(order.id, 'paid', paymentIntentId);

  const txResult = await db.query(
    `INSERT INTO transactions
      (order_id, user_id, stripe_payment_id, amount, currency, status, stripe_token_last4)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [order.id, order.user_id, paymentIntentId, order.total_amount, 'vnd', 'success', last4]
  );
  const tx = txResult.rows[0];

  const signature = hmacSign({
    txId:            tx.id,
    orderId:         order.id,
    paymentIntentId: paymentIntentId,
    amount:          order.total_amount,
    createdAt:       tx.created_at
  });
  await db.query(
    'UPDATE transactions SET hmac_signature = $1 WHERE id = $2',
    [signature, tx.id]
  );

  return { ...tx, hmac_signature: signature };
}

module.exports = { createPaymentIntent, confirmPayment };
