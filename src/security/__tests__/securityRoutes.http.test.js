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
  isReceiptSigningEnabled: jest.fn(() => true),
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

      expect(evidence.status).toBe(401);
      expect(chain.status).toBe(401);
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

      expect(evidence.status).toBe(403);
      expect(chain.status).toBe(403);
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
});
