"use strict";

require("dotenv").config();

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db = require("../db");
const paymentService = require("./paymentService");
const webhookEventService = require("./webhookEventService");
const orderService = require("../orders/orderService");
const auditService = require("../transactions/auditService");

function getPaymentIntent(event) {
  return event.data?.object?.object === "payment_intent"
    ? event.data.object
    : null;
}

function getPaymentAmount(paymentIntent) {
  return paymentIntent.amount_received ?? paymentIntent.amount;
}

async function auditWebhook(eventType, metadata = {}) {
  return auditService.log({
    eventType,
    targetType: "webhook",
    targetId: metadata.eventId || null,
    metadata,
  });
}

async function handleWebhook(req, res) {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    await auditWebhook("webhook_invalid", { reason: "missing_signature" });
    return res.status(400).json({ error: "Missing Stripe-Signature header" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    await auditWebhook("webhook_invalid", {
      reason: "invalid_signature",
      error: err.message,
    });
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  const paymentIntent = getPaymentIntent(event);

  let ledgerEvent;
  try {
    ledgerEvent = await webhookEventService.recordReceivedEvent({
      provider: "stripe",
      providerEventId: event.id,
      eventType: event.type,
      providerPaymentId: paymentIntent?.id || null,
      rawPayload: event,
    });
  } catch {
    return res.status(500).json({ error: "Webhook ledger failed" });
  }

  if (ledgerEvent?.processing_status === "processed") {
    await auditWebhook("webhook_duplicate", {
      eventId: event.id,
      eventType: event.type,
      providerPaymentId: paymentIntent?.id || null,
    });
    return res.status(200).json({ received: true, duplicate: true });
  }

  await auditWebhook("webhook_valid", {
    eventId: event.id,
    eventType: event.type,
    providerPaymentId: paymentIntent?.id || null,
  });

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        if (!paymentIntent) {
          throw Object.assign(new Error("Missing payment_intent object"), {
            statusCode: 400,
          });
        }

        const metadata = paymentIntent.metadata || {};
        const last4 = paymentIntent.payment_method_details?.card?.last4 || null;
        const tx = await paymentService.confirmPayment(paymentIntent.id, last4, {
          provider: "stripe",
          requireFullReconciliation: true,
          providerStatus: paymentIntent.status,
          orderId: metadata.orderId,
          payerUserId: metadata.payerUserId || metadata.userId,
          merchantId: metadata.merchantId,
          amount: getPaymentAmount(paymentIntent),
          currency: paymentIntent.currency,
        });

        await auditService.log({
          eventType: "transaction_success",
          targetType: "transaction",
          targetId: tx.id,
          metadata: {
            eventId: event.id,
            paymentIntentId: paymentIntent.id,
            merchantId: tx.merchant_id,
          },
        });
        await auditService.log({
          eventType: "receipt_issued",
          targetType: "transaction",
          targetId: tx.id,
          metadata: {
            receiptId: tx.receipt_id,
            eventId: event.id,
          },
        });
        break;
      }

      case "payment_intent.payment_failed": {
        if (!paymentIntent) break;
        const errorMsg =
          paymentIntent.last_payment_error?.message || "Unknown error";

        const orderResult = await db.query(
          `SELECT id
           FROM orders
           WHERE stripe_payment_intent_id = $1
           LIMIT 1`,
          [paymentIntent.id],
        );
        const order = orderResult.rows[0];

        if (order) {
          await orderService.updateOrderStatus(
            order.id,
            "payment_failed",
            paymentIntent.id,
          );
        }

        await auditService.log({
          eventType: "transaction_failure",
          targetType: "payment",
          targetId: paymentIntent.id,
          metadata: { eventId: event.id, error: errorMsg },
        });
        break;
      }

      default:
        break;
    }

    await webhookEventService.markProcessed({
      provider: "stripe",
      providerEventId: event.id,
    });
  } catch (err) {
    const isMismatch = /reconciliation mismatch/i.test(err.message);
    await Promise.resolve(
      webhookEventService.markFailed({
        provider: "stripe",
        providerEventId: event.id,
        errorMessage: err.message,
        mismatchReason: isMismatch ? err.message : null,
      }),
    ).catch(() => {});

    await auditWebhook(isMismatch ? "webhook_mismatch" : "webhook_processing_failed", {
      eventId: event.id,
      eventType: event.type,
      providerPaymentId: paymentIntent?.id || null,
      reason: err.message,
    });

    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Webhook processing failed" });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handleWebhook };
