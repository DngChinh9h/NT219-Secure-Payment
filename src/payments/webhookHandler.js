'use strict';
require('dotenv').config();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const paymentService = require('./paymentService');
const webhookEventService = require('./webhookEventService');
const orderService = require('../orders/orderService');
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
  await auditService.log({
    eventType: 'webhook_received',
    payload:   { eventType: event.type, eventId: event.id }
  });

  const paymentIntent = event.data?.object?.object === 'payment_intent'
    ? event.data.object
    : null;

  let ledgerEvent;
  try {
    ledgerEvent = await webhookEventService.recordReceivedEvent({
      provider: 'stripe',
      providerEventId: event.id,
      eventType: event.type,
      providerPaymentId: paymentIntent?.id || null,
      rawPayload: event
    });
  } catch (err) {
    console.error('Webhook ledger record error:', err);
    return res.status(500).json({ error: 'Webhook ledger failed' });
  }

  if (ledgerEvent?.processing_status === 'processed') {
    await auditService.log({
      eventType: 'webhook_duplicate',
      payload:   { eventType: event.type, eventId: event.id }
    });
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const last4 = paymentIntent.payment_method_details?.card?.last4 || null;

        const tx = await paymentService.confirmPayment(paymentIntent.id, last4);

        await auditService.log({
          eventType: 'PAYMENT_SUCCESS',
          payload:   { paymentIntentId: paymentIntent.id, txId: tx.id, last4 }
        });
        await auditService.log({
          eventType: 'payment_succeeded',
          payload:   { paymentIntentId: paymentIntent.id, txId: tx.id, last4 }
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const errorMsg = paymentIntent.last_payment_error?.message || 'Unknown error';

        const orderResult = await db.query(
          `SELECT id
           FROM orders
           WHERE stripe_payment_intent_id = $1
           LIMIT 1`,
          [paymentIntent.id]
        );
        const order = orderResult.rows[0];

        if (order) {
          await orderService.updateOrderStatus(
            order.id,
            'payment_failed',
            paymentIntent.id
          );
        }

        await auditService.log({
          eventType: 'PAYMENT_FAIL',
          payload:   { paymentIntentId: paymentIntent.id, error: errorMsg }
        });
        await auditService.log({
          eventType: 'payment_failed',
          payload:   { paymentIntentId: paymentIntent.id, error: errorMsg }
        });
        break;
      }

      default:
        break;
    }

    await webhookEventService.markProcessed({
      provider: 'stripe',
      providerEventId: event.id
    });
  } catch (err) {
    console.error('Webhook processing error:', err);
    await webhookEventService.markFailed({
      provider: 'stripe',
      providerEventId: event.id,
      errorMessage: err.message
    }).catch(() => {});

    const status = err.statusCode || 500;
    return res.status(status).json({ error: 'Webhook processing failed' });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handleWebhook };
