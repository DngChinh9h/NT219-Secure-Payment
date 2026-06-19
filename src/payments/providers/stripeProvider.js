"use strict";

require("dotenv").config();

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function createPayment({ order, paymentMethodToken, idempotencyKey }) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Number(order.total_amount),
    currency: order.currency || "vnd",
    payment_method: paymentMethodToken,
    payment_method_types: ["card"],
    confirmation_method: "manual",
    confirm: true,
    metadata: {
      orderId: order.id,
      userId: order.user_id,
      payerUserId: order.user_id,
      merchantId: order.merchant_id,
    },
  }, idempotencyKey ? { idempotencyKey } : undefined);

  return {
    provider: "stripe",
    providerPaymentId: paymentIntent.id,
    status: paymentIntent.status,
    clientSecret: paymentIntent.client_secret,
    raw: paymentIntent,
  };
}

async function retrievePayment(providerPaymentId) {
  const paymentIntent = await stripe.paymentIntents.retrieve(providerPaymentId);

  return {
    provider: "stripe",
    providerPaymentId: paymentIntent.id,
    status: paymentIntent.status,
    clientSecret: paymentIntent.client_secret,
    raw: paymentIntent,
  };
}

function mapRefundReason(reason) {
  if (reason === "duplicate" || reason === "fraudulent") {
    return reason;
  }

  return "requested_by_customer";
}

function normalizeRefundStatus(status) {
  if (status === "succeeded" || status === "pending") {
    return status;
  }

  return "failed";
}

function normalizeMetadata(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

async function refundPayment({ providerPaymentId, amount, reason, metadata }) {
  const refund = await stripe.refunds.create({
    payment_intent: providerPaymentId,
    amount: Number(amount),
    reason: mapRefundReason(reason),
    metadata: normalizeMetadata(metadata),
  });

  return {
    provider: "stripe",
    refundId: refund.id,
    status: normalizeRefundStatus(refund.status),
    providerError: refund.failure_reason || null,
    raw: refund,
  };
}

module.exports = {
  createPayment,
  retrievePayment,
  refundPayment,
};
