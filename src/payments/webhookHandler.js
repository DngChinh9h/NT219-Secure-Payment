'use strict';
require('dotenv').config();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const paymentService = require('./paymentService');
const auditService   = require('../transactions/auditService');

async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    return res.status(400).json({ error: 'Missing Stripe-Signature header' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    await auditService.log({
      eventType: 'WEBHOOK_SIGNATURE_FAIL',
      payload:   { error: err.message, sigHeader: sig.substring(0, 50) }
    });

    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  await auditService.log({
    eventType: 'WEBHOOK_RECEIVED',
    payload:   { eventType: event.type, eventId: event.id }
  });

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const last4 = paymentIntent.payment_method_details?.card?.last4 || null;

        const tx = await paymentService.confirmPayment(paymentIntent.id, last4);

        await auditService.log({
          eventType: 'PAYMENT_SUCCESS',
          payload:   { paymentIntentId: paymentIntent.id, txId: tx.id, last4 }
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const errorMsg = paymentIntent.last_payment_error?.message || 'Unknown error';

        await db.query(
          `UPDATE orders SET status = 'failed', updated_at = NOW()
           WHERE stripe_payment_intent_id = $1`,
          [paymentIntent.id]
        );

        await auditService.log({
          eventType: 'PAYMENT_FAIL',
          payload:   { paymentIntentId: paymentIntent.id, error: errorMsg }
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handleWebhook };
