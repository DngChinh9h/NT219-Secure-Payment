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
    txId: "550e8400-e29b-41d4-a716-446655440000",
    orderId: "660e8400-e29b-41d4-a716-446655440000",
    userId: "770e8400-e29b-41d4-a716-446655440000",
    amount: 100000,
    currency: "vnd",
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
      txId: samplePayload.txId,
      orderId: samplePayload.orderId,
      userId: samplePayload.userId,
      amount: samplePayload.amount,
      currency: samplePayload.currency,
      last4: samplePayload.last4,
    });
    expect(decoded.exp).toBeUndefined();
  });

  test("keeps ES512 receipts without key_version verifiable after rotation support", async () => {
    const legacyReceipt = jwt.sign(
      { type: "payment_receipt", ...samplePayload },
      legacyKeys.privateKey,
      {
        algorithm: "ES512",
        issuer: "payment-system",
        audience: "payment-receipt",
      },
    );

    const decoded = await receiptService.verifyReceipt(legacyReceipt);
    expect(decoded.txId).toBe(samplePayload.txId);
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

  test("rejects a tampered receipt", async () => {
    const jws = await receiptService.createSignedReceipt(samplePayload);
    const parts = jws.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    payload.amount = 999999;
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
