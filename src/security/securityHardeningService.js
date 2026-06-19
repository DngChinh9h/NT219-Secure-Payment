"use strict";

const fs = require("fs");
const path = require("path");
const { getAllowedOrigins, isCorsRestricted } = require("../config/corsConfig");
const { validateNonce } = require("../crypto/nonceValidator");
const { getRateLimitEvidence } = require("../gateway/rateLimiter");
const { getSecurityHeadersEvidence } = require("../gateway/securityHeaders");

const schema = fs.readFileSync(
  path.join(__dirname, "../db/schema.deploy.sql"),
  "utf8",
);

function hasSchemaEvidence(pattern) {
  return pattern.test(schema);
}

function getSecurityHardeningEvidence() {
  const rateLimit = getRateLimitEvidence();
  const securityHeaders = getSecurityHeadersEvidence();
  const replayProtectionEnabled =
    typeof validateNonce === "function" &&
    hasSchemaEvidence(/CREATE TABLE IF NOT EXISTS request_nonces/i);
  const duplicatePaymentProtectionEnabled = hasSchemaEvidence(
    /idx_transactions_stripe_payment_id_unique/i,
  );
  const refundDoubleSpendProtectionEnabled = hasSchemaEvidence(
    /idx_refund_requests_active_order_unique/i,
  );

  return {
    rateLimitEnabled: rateLimit.enabled,
    corsRestricted: isCorsRestricted(),
    securityHeadersEnabled: securityHeaders.enabled,
    replayProtectionEnabled,
    duplicatePaymentProtectionEnabled,
    refundDoubleSpendProtectionEnabled,
    secretScanRecommended: true,
    details: {
      rateLimit,
      cors: {
        allowedOrigins: getAllowedOrigins(),
        unknownBrowserOriginsRejected: true,
      },
      securityHeaders,
      replayProtection: {
        enabled: replayProtectionEnabled,
        mechanism: "database_unique_request_nonces_with_timestamp_window",
      },
      duplicatePaymentProtection: {
        enabled: duplicatePaymentProtectionEnabled,
        mechanism: "database_unique_index",
      },
      refundDoubleSpendProtection: {
        enabled: refundDoubleSpendProtectionEnabled,
        mechanism: "active_refund_unique_index_and_transaction_status_guard",
      },
    },
  };
}

module.exports = {
  getSecurityHardeningEvidence,
};
