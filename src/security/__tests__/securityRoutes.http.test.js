"use strict";

const express = require("express");

const mockVerifyJWT = jest.fn();
jest.mock("../../crypto", () => ({
  verifyJWT: mockVerifyJWT,
}));

const mockVerifyAuditChain = jest.fn();
const mockGetLatestEvidenceTimestamps = jest.fn();
jest.mock("../../transactions/auditService", () => ({
  getLatestEvidenceTimestamps: mockGetLatestEvidenceTimestamps,
  log: jest.fn(),
  verifyAuditChain: mockVerifyAuditChain,
}));

jest.mock("../../crypto/receiptService", () => ({
  getReceiptSigningStatus: jest.fn(async () => ({
    receiptSigningEnabled: true,
    currentKeyVersion: 1,
    keyRotationEnabled: true,
    availableKeyVersions: [1],
  })),
}));

jest.mock("../securityServiceClient", () => ({
  getSecurityClientConfigStatus: () => ({
    valid: true,
    checks: {
      securityServiceHttps: true,
      clientCertificateConfigured: true,
      clientPrivateKeyConfigured: true,
      internalCaConfigured: true,
    },
  }),
  getSecurityServiceClient: () => ({
    getPublicKeys: jest.fn(async () => ({ receipt: { activeKeyVersion: 1, availableKeyVersions: [1], keys: [] } })),
    rotateReceiptKey: jest.fn(async () => ({ activeKeyVersion: 2, availableKeyVersions: [1, 2], keys: [{ keyVersion: 2, active: true }] })),
  }),
}));

jest.mock("../reconciliationService", () => ({
  getReconciliationSummary: jest.fn(async () => ({
    totalOrders: 2,
    paidOrders: 1,
    refundedOrders: 1,
    totalTransactions: 2,
    successfulTransactions: 1,
    refundedTransactions: 1,
    refundRequests: 1,
    providerLinkedPayments: 2,
    providerLinkedRefunds: 1,
    status: "ok",
    mismatchCount: 0,
    mismatches: [],
    checkedAt: "2026-06-01T00:00:01.000Z",
  })),
}));

jest.mock("../riskEvidenceService", () => ({
  getRiskEvidence: jest.fn(async () => ({
    status: "review",
    triggeredRules: 1,
    checkedAt: "2026-06-01T00:00:02.000Z",
    rules: {
      duplicatePaymentAttemptsBlocked: { enabled: true, observedCount: 1 },
      duplicateRefundAttemptsBlocked: { enabled: true, observedCount: 1 },
    },
  })),
}));

const securityRoutes = require("../securityRoutes");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/security", securityRoutes);
  app.use((req, res) => res.status(404).json({ error: "Route not found" }));
  return app;
}

async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("securityRoutes HTTP authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAuditChain.mockResolvedValue({
      valid: true,
      checked: 3,
      brokenAt: null,
    });
    mockGetLatestEvidenceTimestamps.mockResolvedValue({
      user_login: "2026-06-01T00:00:00.000Z",
    });
  });

  test("security routes return 401 without a token instead of 404", async () => {
    await withServer(async (baseUrl) => {
      const evidence = await fetch(`${baseUrl}/api/admin/security/evidence`);
      const chain = await fetch(
        `${baseUrl}/api/admin/security/audit-chain/verify`,
      );
      const keys = await fetch(`${baseUrl}/api/admin/security/keys/status`);
      const hardening = await fetch(`${baseUrl}/api/admin/security/hardening`);
      const reconciliation = await fetch(
        `${baseUrl}/api/admin/security/reconciliation`,
      );
      const risk = await fetch(`${baseUrl}/api/admin/security/risk-evidence`);
      const rotate = await fetch(`${baseUrl}/api/admin/security/keys/rotate`, {
        method: "POST",
      });

      expect(evidence.status).toBe(401);
      expect(chain.status).toBe(401);
      expect(keys.status).toBe(401);
      expect(hardening.status).toBe(401);
      expect(reconciliation.status).toBe(401);
      expect(risk.status).toBe(401);
      expect(rotate.status).toBe(401);
    });
  });

  test("security routes return 403 for a customer token", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "customer_1", role: "customer" });

    await withServer(async (baseUrl) => {
      const headers = { Authorization: "Bearer customer-token" };
      const evidence = await fetch(`${baseUrl}/api/admin/security/evidence`, {
        headers,
      });
      const chain = await fetch(
        `${baseUrl}/api/admin/security/audit-chain/verify`,
        { headers },
      );
      const keys = await fetch(`${baseUrl}/api/admin/security/keys/status`, {
        headers,
      });
      const hardening = await fetch(`${baseUrl}/api/admin/security/hardening`, {
        headers,
      });
      const reconciliation = await fetch(
        `${baseUrl}/api/admin/security/reconciliation`,
        { headers },
      );
      const risk = await fetch(`${baseUrl}/api/admin/security/risk-evidence`, {
        headers,
      });
      const rotate = await fetch(`${baseUrl}/api/admin/security/keys/rotate`, {
        method: "POST",
        headers,
      });

      expect(evidence.status).toBe(403);
      expect(chain.status).toBe(403);
      expect(keys.status).toBe(403);
      expect(hardening.status).toBe(403);
      expect(reconciliation.status).toBe(403);
      expect(risk.status).toBe(403);
      expect(rotate.status).toBe(403);
    });
  });

  test("admin receives reconciliation counts and rule-based risk evidence", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "admin_1", role: "admin" });

    await withServer(async (baseUrl) => {
      const headers = { Authorization: "Bearer admin-token" };
      const reconciliationResponse = await fetch(
        `${baseUrl}/api/admin/security/reconciliation`,
        { headers },
      );
      const reconciliation = await reconciliationResponse.json();
      const riskResponse = await fetch(
        `${baseUrl}/api/admin/security/risk-evidence`,
        { headers },
      );
      const risk = await riskResponse.json();

      expect(reconciliationResponse.status).toBe(200);
      expect(reconciliation).toMatchObject({
        totalOrders: 2,
        refundedOrders: 1,
        mismatchCount: 0,
        mismatches: [],
      });
      expect(riskResponse.status).toBe(200);
      expect(risk).toMatchObject({
        status: "review",
        rules: {
          duplicatePaymentAttemptsBlocked: { enabled: true },
          duplicateRefundAttemptsBlocked: { enabled: true },
        },
      });
    });
  });

  test("admin receives security hardening evidence", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "admin_1", role: "admin" });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/security/hardening`, {
        headers: { Authorization: "Bearer admin-token" },
      });
      const evidence = await response.json();

      expect(response.status).toBe(200);
      expect(evidence).toMatchObject({
        rateLimitEnabled: true,
        corsRestricted: true,
        securityHeadersEnabled: true,
        replayProtectionEnabled: true,
        duplicatePaymentProtectionEnabled: true,
        refundDoubleSpendProtectionEnabled: true,
        secretScanRecommended: true,
      });
    });
  });

  test("admin receives evidence and verifies a non-empty audit chain", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "admin_1", role: "admin" });

    await withServer(async (baseUrl) => {
      const headers = { Authorization: "Bearer admin-token" };
      const evidenceResponse = await fetch(
        `${baseUrl}/api/admin/security/evidence`,
        { headers },
      );
      const evidence = await evidenceResponse.json();
      const chainResponse = await fetch(
        `${baseUrl}/api/admin/security/audit-chain/verify`,
        { headers },
      );
      const chain = await chainResponse.json();

      expect(evidenceResponse.status).toBe(200);
      expect(evidence).toMatchObject({
        receiptSigningEnabled: true,
        auditChain: { enabled: true, valid: true, checked: 3 },
        duplicatePaymentProtection: { enabled: true },
        replayProtection: { enabled: true },
        refundDoubleSpendProtection: { enabled: true },
        webhookIdempotency: { enabled: true },
        providerRefundEnabled: true,
      });
      expect(chainResponse.status).toBe(200);
      expect(chain).toEqual({ valid: true, checked: 3, brokenAt: null });
      expect(chain.checked).toBeGreaterThan(0);
    });
  });

  test("admin can inspect status and rotate without receiving private keys", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "admin_1", role: "admin" });

    await withServer(async (baseUrl) => {
      const headers = { Authorization: "Bearer admin-token" };
      const statusResponse = await fetch(
        `${baseUrl}/api/admin/security/keys/status`,
        { headers },
      );
      const status = await statusResponse.json();
      const rotateResponse = await fetch(
        `${baseUrl}/api/admin/security/keys/rotate`,
        { method: "POST", headers },
      );
      const rotated = await rotateResponse.json();

      expect(statusResponse.status).toBe(200);
      expect(status).toMatchObject({
        activeKeyVersion: 1,
        availableKeyVersions: [1],
      });
      expect(rotateResponse.status).toBe(200);
      expect(rotated).toMatchObject({
        activeKeyVersion: 2,
        availableKeyVersions: [1, 2],
      });
      expect(JSON.stringify({ status, rotated })).not.toMatch(/private|encrypted/i);
    });
  });
});
