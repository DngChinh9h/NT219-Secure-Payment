"use strict";

const path = require("path");
const fs = require("fs");

// Verify RSA keys exist before running tests
const keysDir = path.join(__dirname, "../../../keys");

describe("receiptService", () => {
  let createSignedReceipt, verifyReceipt;

  beforeAll(() => {
    // Ensure keys exist
    expect(fs.existsSync(path.join(keysDir, "private.pem"))).toBe(true);
    expect(fs.existsSync(path.join(keysDir, "public.pem"))).toBe(true);

    const receiptService = require("../receiptService");
    createSignedReceipt = receiptService.createSignedReceipt;
    verifyReceipt = receiptService.verifyReceipt;
  });

  const samplePayload = {
    txId: "550e8400-e29b-41d4-a716-446655440000",
    orderId: "660e8400-e29b-41d4-a716-446655440000",
    userId: "770e8400-e29b-41d4-a716-446655440000",
    amount: 100000,
    currency: "vnd",
    last4: "4242",
  };

  test("createSignedReceipt trả về JWS string có 3 phần", () => {
    const jws = createSignedReceipt(samplePayload);
    expect(typeof jws).toBe("string");
    const parts = jws.split(".");
    expect(parts).toHaveLength(3);
    // Each part should be non-empty base64url
    parts.forEach((part) => {
      expect(part.length).toBeGreaterThan(0);
    });
  });

  test("verifyReceipt trả về payload có type = payment_receipt", () => {
    const jws = createSignedReceipt(samplePayload);
    const decoded = verifyReceipt(jws);
    expect(decoded.type).toBe("payment_receipt");
    expect(decoded.txId).toBe(samplePayload.txId);
    expect(decoded.orderId).toBe(samplePayload.orderId);
    expect(decoded.userId).toBe(samplePayload.userId);
    expect(decoded.amount).toBe(samplePayload.amount);
    expect(decoded.currency).toBe(samplePayload.currency);
    expect(decoded.last4).toBe(samplePayload.last4);
    expect(decoded.issuedAt).toBeDefined();
    expect(decoded.iss).toBe("payment-system");
    expect(decoded.aud).toBe("payment-receipt");
  });

  test("sửa 1 ký tự receipt → verify throw error", () => {
    const jws = createSignedReceipt(samplePayload);
    // Tamper with the payload part (change amount in the base64url-encoded payload)
    const parts = jws.split(".");
    // Decode payload, modify it, re-encode
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    payload.amount = 999999; // tamper the amount
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tamperedJws = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(() => verifyReceipt(tamperedJws)).toThrow();
  });

  test("receipt không có expiresIn — không hết hạn", () => {
    const jws = createSignedReceipt(samplePayload);
    const decoded = verifyReceipt(jws);
    // Receipt should NOT have exp field (no expiry)
    expect(decoded.exp).toBeUndefined();
  });
});
