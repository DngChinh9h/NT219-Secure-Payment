"use strict";

const mockVerifyAuditChain = jest.fn();
const mockAuditLog = jest.fn();
jest.mock("../../transactions/auditService", () => ({
  log: mockAuditLog,
  verifyAuditChain: mockVerifyAuditChain,
}));

const mockVerifyReceipt = jest.fn();
jest.mock("../../crypto", () => ({
  verifyReceipt: mockVerifyReceipt,
}));

const mockGetSecurityEvidence = jest.fn();
jest.mock("../securityEvidenceService", () => ({
  getSecurityEvidence: mockGetSecurityEvidence,
}));

const controller = require("../securityController");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("securityController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns audit chain verification with brokenAt field", async () => {
    mockVerifyAuditChain.mockResolvedValueOnce({
      valid: false,
      checked: 3,
      brokenAt: "audit_3",
    });
    const res = mockResponse();

    await controller.verifyAuditChain({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      valid: false,
      checked: 3,
      brokenAt: "audit_3",
    });
  });

  test("returns evidence service result without adding secrets", async () => {
    const evidence = {
      receiptSigning: { enabled: true },
      auditChain: { valid: true },
    };
    mockGetSecurityEvidence.mockResolvedValueOnce(evidence);
    const res = mockResponse();

    await controller.getEvidence({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(evidence);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/secret|private/i);
  });

  test("admin receipt verification returns signed payload", async () => {
    const payload = { txId: "tx_1", amount: 50000 };
    mockVerifyReceipt.mockReturnValueOnce(payload);
    const req = {
      body: { receipt: "header.payload.signature" },
      user: { userId: "admin_1" },
      ip: "127.0.0.1",
    };
    const res = mockResponse();

    await controller.verifyReceipt(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ valid: true, payload });
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "receipt_verified",
        actorUserId: "admin_1",
        targetId: "tx_1",
      }),
    );
  });
});
