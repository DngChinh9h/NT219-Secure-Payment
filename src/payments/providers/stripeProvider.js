"use strict";

require("dotenv").config();

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function createPayment({ order, paymentMethodToken }) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Number(order.total_amount),
    currency: "vnd",
    payment_method: paymentMethodToken,
    payment_method_types: ["card"],
    confirmation_method: "manual",
    confirm: true,
    metadata: {
      orderId: order.id,
      userId: order.user_id,
    },
  });

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

async function refundPayment({ providerPaymentId, amount, reason }) {
  const refund = await stripe.refunds.create({
    payment_intent: providerPaymentId,
    amount: Number(amount),
    reason,
  });

  return {
    provider: "stripe",
    refundId: refund.id,
    status: refund.status,
    raw: refund,
  };
}

module.exports = {
  createPayment,
  retrievePayment,
  refundPayment,
};
