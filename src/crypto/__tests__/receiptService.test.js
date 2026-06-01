"use strict";

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const mockGetActiveSigningKey = jest.fn();
const mockGetPublicKeyForVersion = jest.fn();
const mockGetKeyStatus = jest.fn();
jest.mock("../receiptSigningKeyService", () => ({
  LEGACY_KEY_VERSION: 1,
  getActiveSigningKey: mockGetActiveSigningKey,
  getPublicKeyForVersion: mockGetPublicKeyForVersion,
  getKeyStatus: mockGetKeyStatus,
}));

const keysDir = path.join(__dirname, "../../../keys");
const receiptService = require("../receiptService");

describe("receiptService", () => {
  beforeAll(() => {
    expect(fs.existsSync(path.join(keysDir, "private.pem"))).toBe(true);
    expect(fs.existsSync(path.join(keysDir, "public.pem"))).toBe(true);
  });

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

  test("creates a three-part JWS with legacy key version 1", async () => {
    const jws = await receiptService.createSignedReceipt(samplePayload);
    expect(jws.split(".")).toHaveLength(3);

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

  test("keeps old receipts without key_version verifiable after rotation support", async () => {
    const privateKey = fs.readFileSync(path.join(keysDir, "private.pem"));
    const legacyReceipt = jwt.sign(
      { type: "payment_receipt", ...samplePayload },
      privateKey,
      {
        algorithm: "RS256",
        issuer: "payment-system",
        audience: "payment-receipt",
      },
    );

    const decoded = await receiptService.verifyReceipt(legacyReceipt);
    expect(decoded.txId).toBe(samplePayload.txId);
    expect(decoded.key_version).toBeUndefined();
  });

  test("uses stored public key selected by key_version after rotation", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
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
});
