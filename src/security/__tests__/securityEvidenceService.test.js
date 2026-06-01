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
        algorithm: "RS256",
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
