"use strict";

const crypto = require("crypto");

const TOKEN_STATUSES = Object.freeze({
  mock_success: "succeeded",
  mock_failed: "failed",
  mock_pending: "processing",
});

const REFUND_STATUSES = Object.freeze({
  success: "succeeded",
  failed: "failed",
  pending: "pending",
  mock_refund_success: "succeeded",
  mock_refund_failed: "failed",
  mock_refund_pending: "pending",
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
    payerUserId: order.user_id,
    merchantId: order.merchant_id,
    amount: Number(order.total_amount),
    currency: order.currency || "vnd",
    metadata: {
      orderId: order.id,
      userId: order.user_id,
      payerUserId: order.user_id,
      merchantId: order.merchant_id,
    },
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

async function refundPayment({
  providerPaymentId,
  amount,
  reason,
  metadata = {},
  mockRefundOutcome = "success",
}) {
  const refundId = `mock_re_${crypto.randomUUID()}`;
  const status = REFUND_STATUSES[mockRefundOutcome];

  if (!status) {
    const err = new Error("Invalid MockBank refund outcome");
    err.statusCode = 400;
    throw err;
  }

  const providerError = status === "failed" ? "MockBank refund failed" : null;

  return {
    provider: "mock_bank",
    refundId,
    status,
    providerError,
    raw: {
      id: refundId,
      providerPaymentId,
      amount: Number(amount),
      reason,
      metadata,
      status,
    },
  };
}

module.exports = {
  createPayment,
  retrievePayment,
  refundPayment,
};
