"use strict";
const rateLimit = require("express-rate-limit");

function getPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const RATE_LIMIT_POLICIES = Object.freeze({
  general: {
    windowMs: 60 * 1000,
    max: getPositiveIntegerEnv("RATE_LIMIT_GENERAL_MAX", 300),
  },
  auth: {
    windowMs: 60 * 1000,
    max: getPositiveIntegerEnv("RATE_LIMIT_AUTH_MAX", 30),
  },
  paymentCreateIntent: {
    windowMs: 60 * 1000,
    max: getPositiveIntegerEnv("RATE_LIMIT_PAYMENT_MAX", 60),
  },
  refundRequest: {
    windowMs: 60 * 1000,
    max: getPositiveIntegerEnv("RATE_LIMIT_REFUND_REQUEST_MAX", 30),
  },
  adminRefund: {
    windowMs: 60 * 1000,
    max: getPositiveIntegerEnv("RATE_LIMIT_ADMIN_REFUND_MAX", 60),
  },
});

function createLimiter(policyName, message) {
  const policy = RATE_LIMIT_POLICIES[policyName];

  return rateLimit({
    windowMs: policy.windowMs,
    max: policy.max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

const generalLimiter = createLimiter("general", "Too many requests from this IP.");
const loginLimiter = createLimiter("auth", "Too many login attempts. Try again later.");
const registerLimiter = createLimiter("auth", "Too many registration attempts. Try again later.");
const paymentCreateIntentLimiter = createLimiter(
  "paymentCreateIntent",
  "Too many payment requests. Try again later.",
);
const refundRequestLimiter = createLimiter(
  "refundRequest",
  "Too many refund requests. Try again later.",
);
const adminRefundLimiter = createLimiter(
  "adminRefund",
  "Too many admin refund actions. Try again later.",
);

function getRateLimitEvidence() {
  return {
    enabled: true,
    policies: Object.fromEntries(
      Object.entries(RATE_LIMIT_POLICIES).map(([name, policy]) => [
        name,
        { windowMs: policy.windowMs, max: policy.max },
      ]),
    ),
  };
}

module.exports = {
  RATE_LIMIT_POLICIES,
  adminRefundLimiter,
  generalLimiter,
  getRateLimitEvidence,
  loginLimiter,
  paymentCreateIntentLimiter,
  registerLimiter,
  refundRequestLimiter,
};
