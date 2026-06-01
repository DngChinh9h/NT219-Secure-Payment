"use strict";

const auditService = require("../transactions/auditService");
const { isReceiptSigningEnabled } = require("../crypto/receiptService");

const EVIDENCE_EVENT_TYPES = Object.freeze([
  "user_register",
  "user_login",
  "order_created",
  "payment_created",
  "payment_succeeded",
  "receipt_issued",
  "refund_requested",
  "refund_approved",
  "provider_refund_succeeded",
  "provider_refund_failed",
  "admin_rejected_refund",
]);

async function getSecurityEvidence() {
  const [auditChain, latestEvidenceTimestamps] = await Promise.all([
    auditService.verifyAuditChain(),
    auditService.getLatestEvidenceTimestamps(EVIDENCE_EVENT_TYPES),
  ]);
  const receiptSigningEnabled = isReceiptSigningEnabled();

  return {
    receiptSigningEnabled,
    receiptSigning: {
      enabled: receiptSigningEnabled,
      algorithm: "RS256",
    },
    auditChain: {
      enabled: true,
      algorithm: "SHA-256",
      ...auditChain,
    },
    duplicatePaymentProtection: {
      enabled: true,
      mechanism: "database_unique_index",
    },
    replayProtection: {
      enabled: true,
      mechanism: "nonce_and_timestamp_window",
    },
    refundDoubleSpendProtection: {
      enabled: true,
      mechanism: "transaction_status_guard",
    },
    webhookIdempotency: {
      enabled: true,
      mechanism: "provider_event_ledger",
    },
    providerRefund: {
      enabled: true,
      providers: ["stripe", "mock_bank"],
    },
    providerRefundEnabled: true,
    latestEvidenceTimestamps,
  };
}

module.exports = {
  EVIDENCE_EVENT_TYPES,
  getSecurityEvidence,
};
