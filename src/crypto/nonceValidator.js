"use strict";

const { DEFAULT_WINDOW_MS } = require("../security/requestNonceService");

function validateNonce(nonce, timestamp) {
  if (!nonce || !timestamp) {
    return { valid: false, reason: "Missing nonce or timestamp" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: "Invalid timestamp" };
  }

  if (Math.abs(Date.now() - ts) > DEFAULT_WINDOW_MS) {
    return {
      valid: false,
      reason: "Request expired or timestamp is too far from server time",
    };
  }

  return { valid: true };
}

function _clearNonces() {
  // Retained for older tests; replay state now lives in the database.
}

module.exports = {
  validateNonce,
  _clearNonces,
};
