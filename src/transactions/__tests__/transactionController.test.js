"use strict";

const mockVerifyReceipt = jest.fn();
jest.mock("../../crypto", () => ({
  verifyReceipt: mockVerifyReceipt,
}));

const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
}));

const mockAuditLog = jest.fn();
const mockVerifyAuditChain = jest.fn();
jest.mock("../auditService", () => ({
  log: mockAuditLog,
  verifyAuditChain: mockVerifyAuditChain,
}));

const {
  getMyTransactions,
  verifyAuditLogs,
  verifyReceipt,
} = require("../transactionController");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("transactionController getMyTransactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns provider and refund fields with legacy transaction fields", async () => {
    const row = {
      id: "tx_1",
      amount: "50000",
      currency: "vnd",
      status: "refunded",
      provider: "mock_bank",
      provider_payment_id: "mock_pi_1",
      refund_id: "mock_re_1",
      refunded_at: null,
      refund_reason: "requested_by_customer",
      stripe_token_last4: null,
      jws_receipt: "receipt",
      created_at: "2026-05-30T00:00:00.000Z",
      order_id: "order_1",
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const req = { user: { userId: "user_1" } };
    const res = mockResponse();

    await getMyTransactions(req, res);

    expect(mockQuery.mock.calls[0][0]).toContain("t.provider");
    expect(mockQuery.mock.calls[0][0]).toContain("t.provider_payment_id");
    expect(mockQuery.mock.calls[0][0]).toContain("t.refund_id");
    expect(mockQuery.mock.calls[0][0]).toContain("t.refunded_at");
    expect(mockQuery.mock.calls[0][0]).toContain("t.refund_reason");
    expect(mockQuery.mock.calls[0][1]).toEqual(["user_1"]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ transactions: [row] });
  });
});

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
        targetType: "transaction",
        targetId: "tx_1",
        metadata: { valid: true },
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
        metadata: expect.objectContaining({ valid: false }),
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
