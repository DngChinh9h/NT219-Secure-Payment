"use strict";

const mockVerifyAuditChain = jest.fn();
const mockGetLatestEvidenceTimestamps = jest.fn();
jest.mock("../../transactions/auditService", () => ({
  verifyAuditChain: mockVerifyAuditChain,
  getLatestEvidenceTimestamps: mockGetLatestEvidenceTimestamps,
}));

const mockIsReceiptSigningEnabled = jest.fn();
jest.mock("../../crypto/receiptService", () => ({
  isReceiptSigningEnabled: mockIsReceiptSigningEnabled,
}));

const service = require("../securityEvidenceService");

describe("securityEvidenceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns real security evidence values without secrets", async () => {
    mockIsReceiptSigningEnabled.mockReturnValueOnce(true);
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
      receiptSigning: { enabled: true, algorithm: "RS256" },
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
    });

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toMatch(/STRIPE_SECRET_KEY|DATABASE_URL|PRIVATE_KEY|whsec_|sk_live_|sk_test_/);
  });
});
