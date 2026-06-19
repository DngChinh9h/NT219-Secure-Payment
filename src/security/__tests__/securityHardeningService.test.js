"use strict";

const service = require("../securityHardeningService");

describe("securityHardeningService", () => {
  test("returns real enabled controls without secret values", () => {
    const evidence = service.getSecurityHardeningEvidence();

    expect(evidence).toMatchObject({
      rateLimitEnabled: true,
      corsRestricted: true,
      securityHeadersEnabled: true,
      replayProtectionEnabled: true,
      duplicatePaymentProtectionEnabled: true,
      refundDoubleSpendProtectionEnabled: true,
      securityServiceMtlsEnabled: expect.any(Boolean),
      secretScanRecommended: true,
    });
    expect(evidence.details.rateLimit.policies).toHaveProperty("auth");
    expect(evidence.details.rateLimit.policies).toHaveProperty(
      "paymentCreateIntent",
    );
    expect(evidence.details.rateLimit.policies).toHaveProperty("refundRequest");
    expect(evidence.details.rateLimit.policies).toHaveProperty("adminRefund");
    expect(JSON.stringify(evidence)).not.toMatch(
      /DATABASE_URL|PRIVATE_KEY|STRIPE_SECRET_KEY|KMS_MASTER_KEY|HMAC_SECRET/,
    );
  });
});
