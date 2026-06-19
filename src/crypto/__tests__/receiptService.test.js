"use strict";

const mockSignReceipt = jest.fn();
const mockVerifyReceipt = jest.fn();
const mockGetPublicKeys = jest.fn();
jest.mock("../../security/securityServiceClient", () => ({
  getSecurityServiceClient: () => ({
    signReceipt: mockSignReceipt,
    verifyReceipt: mockVerifyReceipt,
    getPublicKeys: mockGetPublicKeys,
  }),
}));

const receiptService = require("../receiptService");

const samplePayload = {
  receiptId: "440e8400-e29b-41d4-a716-446655440000",
  transactionId: "550e8400-e29b-41d4-a716-446655440000",
  orderId: "660e8400-e29b-41d4-a716-446655440000",
  payerUserId: "770e8400-e29b-41d4-a716-446655440000",
  merchantId: "880e8400-e29b-41d4-a716-446655440000",
  provider: "stripe",
  providerPaymentId: "pi_receipt_1",
  amount: 100000,
  currency: "vnd",
  status: "PAID",
  orderItemsHash: "abc123",
};

describe("receiptService Security Service boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignReceipt.mockResolvedValue({ jws: "header.payload.signature", keyVersion: 2 });
    mockGetPublicKeys.mockResolvedValue({ receipt: { activeKeyVersion: 2, availableKeyVersions: [1, 2] } });
  });

  test("builds canonical receipt payload then delegates signing", async () => {
    await expect(receiptService.createSignedReceipt(samplePayload)).resolves.toBe("header.payload.signature");
    expect(mockSignReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receipt_id: samplePayload.receiptId,
      transaction_id: samplePayload.transactionId,
      order_id: samplePayload.orderId,
      payer_user_id: samplePayload.payerUserId,
      merchant_id: samplePayload.merchantId,
      payee_id: samplePayload.merchantId,
      issuer: "payment-system",
      audience: "payment-receipt",
    }));
  });

  test("delegates receipt verification and surfaces tamper failure", async () => {
    mockVerifyReceipt.mockResolvedValueOnce({ transaction_id: samplePayload.transactionId, amount: 100000 });
    await expect(receiptService.verifyReceipt("valid-jws")).resolves.toMatchObject({ amount: 100000 });
    mockVerifyReceipt.mockRejectedValueOnce(new Error("Invalid receipt"));
    await expect(receiptService.verifyReceipt("tampered-jws")).rejects.toThrow("Invalid receipt");
  });

  test("reads only public key metadata from Security Service", async () => {
    await expect(receiptService.getReceiptSigningStatus()).resolves.toEqual({
      receiptSigningEnabled: false,
      currentKeyVersion: 2,
      keyRotationEnabled: true,
      availableKeyVersions: [1, 2],
    });
    expect(mockGetPublicKeys).toHaveBeenCalledTimes(1);
  });
});
