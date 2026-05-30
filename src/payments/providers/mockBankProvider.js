"use strict";

const crypto = require("crypto");

const TOKEN_STATUSES = Object.freeze({
  mock_success: "succeeded",
  mock_failed: "failed",
  mock_pending: "processing",
});

async function createPayment({ order, paymentMethodToken }) {
  const status = TOKEN_STATUSES[paymentMethodToken];

  if (!status) {
    const err = new Error("Invalid MockBank payment token");
    err.statusCode = 400;
    throw err;
  }

  const providerPaymentId = `mock_pi_${crypto.randomUUID()}`;
  const raw = {
    id: providerPaymentId,
    orderId: order.id,
    userId: order.user_id,
    amount: Number(order.total_amount),
    currency: "vnd",
    status,
    token: paymentMethodToken,
  };

  return {
    provider: "mock_bank",
    providerPaymentId,
    status,
    clientSecret: null,
    raw,
  };
}

async function retrievePayment(providerPaymentId) {
  return {
    provider: "mock_bank",
    providerPaymentId,
    status: "processing",
    clientSecret: null,
    raw: { id: providerPaymentId },
  };
}

async function refundPayment({ providerPaymentId, amount, reason }) {
  const refundId = `mock_re_${crypto.randomUUID()}`;

  return {
    provider: "mock_bank",
    refundId,
    status: "succeeded",
    raw: {
      id: refundId,
      providerPaymentId,
      amount: Number(amount),
      reason,
      status: "succeeded",
    },
  };
}

module.exports = {
  createPayment,
  retrievePayment,
  refundPayment,
};
