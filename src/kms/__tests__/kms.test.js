"use strict";

const crypto = require("crypto");

process.env.KMS_MASTER_KEY = crypto.randomBytes(32).toString("hex");

const {
  WRAP_ALG,
  decodeMasterKey,
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
} = require("../kmsService");

describe("KMS envelope wrapping", () => {
  test("decodeMasterKey accepts 32-byte hex and base64", () => {
    const key = crypto.randomBytes(32);
    process.env.KMS_MASTER_KEY = key.toString("hex");
    expect(decodeMasterKey().equals(key)).toBe(true);
    process.env.KMS_MASTER_KEY = key.toString("base64");
    expect(decodeMasterKey().equals(key)).toBe(true);
  });

  test("generateDataKey returns plaintext and AES-GCM envelope", () => {
    const { plaintext, wrapped } = generateDataKey();
    const envelope = JSON.parse(wrapped);

    expect(plaintext).toBeInstanceOf(Buffer);
    expect(plaintext).toHaveLength(32);
    expect(envelope.alg).toBe(WRAP_ALG);
    expect(Buffer.from(envelope.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(envelope.authTag, "base64")).toHaveLength(16);
  });

  test("unwrapDataKey restores plaintext", () => {
    const { plaintext, wrapped } = generateDataKey();
    const unwrapped = unwrapDataKey(wrapped);
    expect(unwrapped.equals(plaintext)).toBe(true);
  });

  test("wrapDataKey uses a random IV each time", () => {
    const dataKey = crypto.randomBytes(32);
    const a = JSON.parse(wrapDataKey(dataKey));
    const b = JSON.parse(wrapDataKey(dataKey));
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test("tampering with authTag or ciphertext fails unwrap", () => {
    const { wrapped } = generateDataKey();
    const tagTampered = JSON.parse(wrapped);
    tagTampered.authTag = Buffer.alloc(16).toString("base64");
    expect(() => unwrapDataKey(JSON.stringify(tagTampered))).toThrow();

    const ciphertextTampered = JSON.parse(wrapped);
    ciphertextTampered.ciphertext = Buffer.alloc(32).toString("base64");
    expect(() => unwrapDataKey(JSON.stringify(ciphertextTampered))).toThrow();
  });
});
