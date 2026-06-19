"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const legacyKeys = crypto.generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

delete process.env.JWT_PRIVATE_KEY_PATH;
delete process.env.JWT_PUBLIC_KEY_PATH;
process.env.JWT_PRIVATE_KEY_B64 = Buffer.from(legacyKeys.privateKey).toString("base64");
process.env.JWT_PUBLIC_KEY_B64 = Buffer.from(legacyKeys.publicKey).toString("base64");

const mockGetActiveSigningKey = jest.fn();
const mockGetPublicKeyForVersion = jest.fn();
const mockGetKeyStatus = jest.fn();
jest.mock("../receiptSigningKeyService", () => ({
  LEGACY_KEY_VERSION: 1,
  getActiveSigningKey: mockGetActiveSigningKey,
  getPublicKeyForVersion: mockGetPublicKeyForVersion,
  getKeyStatus: mockGetKeyStatus,
}));

const receiptService = require("../receiptService");

function generateReceiptKeyPair() {
  return crypto.generateKeyPairSync("ec", {
    namedCurve: "secp521r1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

describe("receiptService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveSigningKey.mockResolvedValue(null);
    mockGetPublicKeyForVersion.mockResolvedValue(null);
    mockGetKeyStatus.mockResolvedValue({
      activeKeyVersion: 1,
      availableKeyVersions: [1],
      keyRotationEnabled: false,
      keyStoreReady: false,
      keys: [],
    });
  });

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
    last4: "4242",
  };

  test("creates a three-part ES512 JWS with legacy key version 1", async () => {
    const jws = await receiptService.createSignedReceipt(samplePayload);
    expect(jws.split(".")).toHaveLength(3);
    expect(jwt.decode(jws, { complete: true }).header.alg).toBe("ES512");

    const decoded = await receiptService.verifyReceipt(jws);
    expect(decoded).toMatchObject({
      type: "payment_receipt",
      key_version: 1,
      receipt_id: samplePayload.receiptId,
      transaction_id: samplePayload.transactionId,
      order_id: samplePayload.orderId,
      payer_user_id: samplePayload.payerUserId,
      merchant_id: samplePayload.merchantId,
      provider_payment_id: samplePayload.providerPaymentId,
      amount: samplePayload.amount,
      currency: samplePayload.currency,
      status: "PAID",
      order_items_hash: "abc123",
      last4: samplePayload.last4,
    });
    expect(decoded.exp).toBeUndefined();
  });

  test("keeps ES512 receipts without key_version verifiable after rotation support", async () => {
    const legacyPayload = {
      txId: samplePayload.transactionId,
      orderId: samplePayload.orderId,
      userId: samplePayload.payerUserId,
      amount: samplePayload.amount,
      currency: samplePayload.currency,
    };
    const legacyReceipt = jwt.sign(
      { type: "payment_receipt", ...legacyPayload },
      legacyKeys.privateKey,
      {
        algorithm: "ES512",
        issuer: "payment-system",
        audience: "payment-receipt",
      },
    );

    const decoded = await receiptService.verifyReceipt(legacyReceipt);
    expect(decoded.txId).toBe(samplePayload.transactionId);
    expect(decoded.key_version).toBeUndefined();
  });

  test("uses stored public key selected by key_version after rotation", async () => {
    const { publicKey, privateKey } = generateReceiptKeyPair();
    mockGetActiveSigningKey.mockResolvedValueOnce({
      keyVersion: 2,
      privateKey,
      publicKey,
    });
    mockGetPublicKeyForVersion.mockImplementation(async (version) =>
      version === 2 ? publicKey : null,
    );

    const jws = await receiptService.createSignedReceipt(samplePayload);
    const decoded = await receiptService.verifyReceipt(jws);

    expect(decoded.key_version).toBe(2);
    expect(jwt.decode(jws, { complete: true }).header.kid).toBe("2");
  });

  test("old receipt still verifies after rotating to a newer active key", async () => {
    const oldKeys = generateReceiptKeyPair();
    const newKeys = generateReceiptKeyPair();

    mockGetActiveSigningKey.mockResolvedValueOnce({
      keyVersion: 2,
      privateKey: oldKeys.privateKey,
      publicKey: oldKeys.publicKey,
    });
    mockGetPublicKeyForVersion.mockImplementation(async (version) => {
      if (version === 2) return oldKeys.publicKey;
      if (version === 3) return newKeys.publicKey;
      return null;
    });
    const oldReceipt = await receiptService.createSignedReceipt(samplePayload);

    mockGetActiveSigningKey.mockResolvedValueOnce({
      keyVersion: 3,
      privateKey: newKeys.privateKey,
      publicKey: newKeys.publicKey,
    });
    const newReceipt = await receiptService.createSignedReceipt(samplePayload);

    await expect(receiptService.verifyReceipt(oldReceipt)).resolves.toMatchObject({
      key_version: 2,
    });
    await expect(receiptService.verifyReceipt(newReceipt)).resolves.toMatchObject({
      key_version: 3,
    });
  });

  test.each([
    ["amount", 999999],
    ["merchant_id", "990e8400-e29b-41d4-a716-446655440000"],
    ["order_id", "990e8400-e29b-41d4-a716-446655440000"],
  ])("rejects a tampered %s", async (field, value) => {
    const jws = await receiptService.createSignedReceipt(samplePayload);
    const parts = jws.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    payload[field] = value;
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");

    await expect(receiptService.verifyReceipt(parts.join("."))).rejects.toThrow();
  });

  test("rejects a malformed key_version before querying the key store", async () => {
    const receipt = jwt.sign(
      { type: "payment_receipt", ...samplePayload, key_version: "invalid" },
      legacyKeys.privateKey,
      {
        algorithm: "ES512",
        issuer: "payment-system",
        audience: "payment-receipt",
      },
    );

    await expect(receiptService.verifyReceipt(receipt)).rejects.toThrow(
      "Invalid receipt signing key version",
    );
    expect(mockGetPublicKeyForVersion).not.toHaveBeenCalled();
  });
});
