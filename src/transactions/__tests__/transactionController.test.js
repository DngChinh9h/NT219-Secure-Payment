"use strict";

const mockVerifyReceipt = jest.fn();
jest.mock("../../crypto", () => ({
  verifyReceipt: mockVerifyReceipt,
}));

jest.mock("../../db", () => ({
  query: jest.fn(),
}));

const { verifyReceipt } = require("../transactionController");

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
