"use strict";

const mockVerifyAuditChain = jest.fn();
const mockGetLatestEvidenceTimestamps = jest.fn();
jest.mock("../../transactions/auditService", () => ({
  verifyAuditChain: mockVerifyAuditChain,
  getLatestEvidenceTimestamps: mockGetLatestEvidenceTimestamps,
}));

const mockGetReceiptSigningStatus = jest.fn();
jest.mock("../../crypto/receiptService", () => ({
  getReceiptSigningStatus: mockGetReceiptSigningStatus,
}));

const mockGetSecurityHardeningEvidence = jest.fn();
jest.mock("../securityHardeningService", () => ({
  getSecurityHardeningEvidence: mockGetSecurityHardeningEvidence,
}));

const mockGetReconciliationSummary = jest.fn();
jest.mock("../reconciliationService", () => ({
  getReconciliationSummary: mockGetReconciliationSummary,
}));

const mockGetRiskEvidence = jest.fn();
jest.mock("../riskEvidenceService", () => ({
  getRiskEvidence: mockGetRiskEvidence,
}));

const service = require("../securityEvidenceService");

describe("securityEvidenceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns real security evidence values without secrets", async () => {
    mockGetReceiptSigningStatus.mockResolvedValueOnce({
      receiptSigningEnabled: true,
      currentKeyVersion: 2,
      keyRotationEnabled: true,
      availableKeyVersions: [1, 2],
    });
    mockGetSecurityHardeningEvidence.mockReturnValueOnce({
      rateLimitEnabled: true,
      corsRestricted: true,
      securityHeadersEnabled: true,
    });
    mockGetReconciliationSummary.mockResolvedValueOnce({
      status: "ok",
      mismatchCount: 0,
      checkedAt: "2026-06-01T00:00:01.000Z",
    });
    mockGetRiskEvidence.mockResolvedValueOnce({
      status: "review",
      triggeredRules: 2,
      checkedAt: "2026-06-01T00:00:02.000Z",
    });
    mockVerifyAuditChain.mockResolvedValueOnce({
      valid: true,
      checked: 12,
      brokenAt: null,
    });
    mockGetLatestEvidenceTimestamps.mockResolvedValueOnce({
      user_login: "2026-06-01T00:00:00.000Z",
      provider_refund_succeeded: null,
    });

    const evidence = await service.getSecurityEvidence();

    expect(evidence).toMatchObject({
      receiptSigningEnabled: true,
      currentKeyVersion: 2,
      keyRotationEnabled: true,
      availableKeyVersions: [1, 2],
      receiptSigning: {
        enabled: true,
        algorithm: "ES512",
        currentKeyVersion: 2,
      },
      auditChain: {
        enabled: true,
        algorithm: "SHA-256",
        valid: true,
        checked: 12,
        brokenAt: null,
      },
      duplicatePaymentProtection: { enabled: true },
      replayProtection: { enabled: true },
      refundDoubleSpendProtection: { enabled: true },
      webhookIdempotency: { enabled: true },
      providerRefund: {
        enabled: true,
        providers: ["stripe", "mock_bank"],
      },
      providerRefundEnabled: true,
      reconciliationEnabled: true,
      fraudRiskEvidenceEnabled: true,
      latestReconciliationStatus: {
        status: "ok",
        mismatchCount: 0,
      },
      latestRiskStatus: {
        status: "review",
        triggeredRules: 2,
      },
      hardening: {
        rateLimitEnabled: true,
        corsRestricted: true,
        securityHeadersEnabled: true,
      },
    });

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toMatch(/STRIPE_SECRET_KEY|DATABASE_URL|PRIVATE_KEY|whsec_|sk_live_|sk_test_/);
  });
});
