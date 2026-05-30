"use strict";

const mockVerifyReceipt = jest.fn();
jest.mock("../../crypto", () => ({
  verifyReceipt: mockVerifyReceipt,
}));

jest.mock("../../db", () => ({
  query: jest.fn(),
}));

const mockAuditLog = jest.fn();
const mockVerifyAuditChain = jest.fn();
jest.mock("../auditService", () => ({
  log: mockAuditLog,
  verifyAuditChain: mockVerifyAuditChain,
}));

const {
  verifyAuditLogs,
  verifyReceipt,
} = require("../transactionController");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("transactionController verifyReceipt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns valid true with receipt payload", async () => {
    const payload = { txId: "tx_1", amount: 50000 };
    mockVerifyReceipt.mockReturnValueOnce(payload);

    const req = { body: { receipt: "header.payload.signature" } };
    const res = mockResponse();

    await verifyReceipt(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ valid: true, payload });
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "receipt_verified",
        payload: { valid: true, txId: "tx_1" },
      }),
    );
  });

  test("returns valid false for tampered receipt without 500", async () => {
    mockVerifyReceipt.mockImplementationOnce(() => {
      throw new Error("bad signature");
    });

    const req = { body: { receipt: "tampered" } };
    const res = mockResponse();

    await verifyReceipt(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      valid: false,
      error: "Invalid receipt",
    });
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "receipt_verified",
        payload: expect.objectContaining({ valid: false }),
      }),
    );
  });

  test("returns valid false for missing receipt", async () => {
    const req = { body: {} };
    const res = mockResponse();

    await verifyReceipt(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      valid: false,
      error: "Invalid receipt",
    });
  });
});

describe("transactionController verifyAuditLogs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns audit chain verification result", async () => {
    mockVerifyAuditChain.mockResolvedValueOnce({ valid: true, checked: 12 });

    const req = { query: {} };
    const res = mockResponse();

    await verifyAuditLogs(req, res);

    expect(mockVerifyAuditChain).toHaveBeenCalledWith({ limit: 1000 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ valid: true, checked: 12 });
  });

  test("passes numeric limit to auditService", async () => {
    mockVerifyAuditChain.mockResolvedValueOnce({
      valid: false,
      checked: 2,
      failedAt: "audit_2",
    });

    const req = { query: { limit: "50" } };
    const res = mockResponse();

    await verifyAuditLogs(req, res);

    expect(mockVerifyAuditChain).toHaveBeenCalledWith({ limit: 50 });
    expect(res.json).toHaveBeenCalledWith({
      valid: false,
      checked: 2,
      failedAt: "audit_2",
    });
  });
});
