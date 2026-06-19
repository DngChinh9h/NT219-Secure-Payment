"use strict";

const mockVerifyAuditChain = jest.fn();
const mockAuditLog = jest.fn();
jest.mock("../../transactions/auditService", () => ({ log: mockAuditLog, verifyAuditChain: mockVerifyAuditChain }));
const mockVerifyReceipt = jest.fn();
jest.mock("../../crypto", () => ({ verifyReceipt: mockVerifyReceipt }));
jest.mock("../securityEvidenceService", () => ({ getSecurityEvidence: jest.fn() }));
jest.mock("../securityHardeningService", () => ({ getSecurityHardeningEvidence: jest.fn() }));
jest.mock("../reconciliationService", () => ({ getReconciliationSummary: jest.fn() }));
jest.mock("../riskEvidenceService", () => ({ getRiskEvidence: jest.fn() }));

const mockGetPublicKeys = jest.fn();
const mockRotateReceiptKey = jest.fn();
jest.mock("../securityServiceClient", () => ({
  getSecurityServiceClient: () => ({ getPublicKeys: mockGetPublicKeys, rotateReceiptKey: mockRotateReceiptKey }),
}));

const controller = require("../securityController");
function mockResponse() { const res = {}; res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res); return res; }

describe("securityController Security Service delegation", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test("verifies receipts through the Security Service-backed receipt service", async () => {
    mockVerifyReceipt.mockResolvedValueOnce({ transaction_id: "tx_1", amount: 50000 });
    const res = mockResponse();
    await controller.verifyReceipt({ body: { receipt: "header.payload.signature" }, user: { userId: "admin_1" }, ip: "127.0.0.1" }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ valid: true, payload: { transaction_id: "tx_1", amount: 50000 } });
  });

  test("returns public receipt key status only", async () => {
    mockGetPublicKeys.mockResolvedValueOnce({ receipt: { activeKeyVersion: 2, availableKeyVersions: [1, 2], keys: [{ keyVersion: 2, active: true }] } });
    const res = mockResponse();
    await controller.getReceiptSigningKeyStatus({}, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ activeKeyVersion: 2 }));
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/private|encrypted/i);
  });

  test("forwards key rotation to Security Service and audits the result", async () => {
    mockRotateReceiptKey.mockResolvedValueOnce({ activeKeyVersion: 3, availableKeyVersions: [1, 2, 3] });
    const res = mockResponse();
    await controller.rotateReceiptSigningKey({ user: { userId: "admin_1" }, ip: "127.0.0.1" }, res);
    expect(mockRotateReceiptKey).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: "key_rotation", targetId: "3" }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
