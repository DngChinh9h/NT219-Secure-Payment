"use strict";

const auditService = require("../transactions/auditService");
const { getReceiptSigningStatus } = require("../crypto/receiptService");
const { getSecurityHardeningEvidence } = require("./securityHardeningService");
const { getReconciliationSummary } = require("./reconciliationService");
const { getRiskEvidence } = require("./riskEvidenceService");

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
  "receipt_signing_key_rotated",
  "refund_request_blocked",
  "refund_approval_blocked",
]);

async function getSecurityEvidence() {
  const [
    auditChain,
    latestEvidenceTimestamps,
    receiptSigningStatus,
    reconciliation,
    riskEvidence,
  ] = await Promise.all([
    auditService.verifyAuditChain(),
    auditService.getLatestEvidenceTimestamps(EVIDENCE_EVENT_TYPES),
    getReceiptSigningStatus(),
    getReconciliationSummary(),
    getRiskEvidence(),
  ]);
  const hardening = getSecurityHardeningEvidence();

  return {
    ...receiptSigningStatus,
    receiptSigning: {
      enabled: receiptSigningStatus.receiptSigningEnabled,
      algorithm: "ES512",
      currentKeyVersion: receiptSigningStatus.currentKeyVersion,
      keyRotationEnabled: receiptSigningStatus.keyRotationEnabled,
      availableKeyVersions: receiptSigningStatus.availableKeyVersions,
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
    reconciliationEnabled: true,
    fraudRiskEvidenceEnabled: true,
    latestReconciliationStatus: {
      status: reconciliation.status,
      mismatchCount: reconciliation.mismatchCount,
      checkedAt: reconciliation.checkedAt,
    },
    latestRiskStatus: {
      status: riskEvidence.status,
      triggeredRules: riskEvidence.triggeredRules,
      checkedAt: riskEvidence.checkedAt,
    },
    hardening,
    latestEvidenceTimestamps,
  };
}

module.exports = {
  EVIDENCE_EVENT_TYPES,
  getSecurityEvidence,
};
