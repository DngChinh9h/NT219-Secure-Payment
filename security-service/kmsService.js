"use strict";

const crypto = require("crypto");

const WRAP_ALG = "AES-256-GCM";
const WRAP_VERSION = 1;

function decodeMasterKey(value = process.env.KMS_MASTER_KEY) {
  if (!value) throw new Error("KMS_MASTER_KEY is required by Security Service");
  const trimmed = value.trim();
  const key = /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("KMS_MASTER_KEY must decode to exactly 32 bytes");
  return key;
}

function wrapDataKey(plaintext, masterKey = decodeMasterKey()) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length !== 32) {
    throw new Error("Data key must be exactly 32 bytes");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: WRAP_VERSION,
    alg: WRAP_ALG,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function unwrapDataKey(wrapped, masterKey = decodeMasterKey()) {
  let envelope;
  try {
    envelope = JSON.parse(wrapped);
  } catch {
    throw new Error("Wrapped data key is not a supported AES-GCM envelope");
  }
  if (envelope.v !== WRAP_VERSION || envelope.alg !== WRAP_ALG) {
    throw new Error("Unsupported wrapped data key version or algorithm");
  }
  const iv = Buffer.from(envelope.iv || "", "base64");
  const authTag = Buffer.from(envelope.authTag || "", "base64");
  const ciphertext = Buffer.from(envelope.ciphertext || "", "base64");
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length !== 32) {
    throw new Error("Invalid wrapped data key parameters");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { WRAP_ALG, WRAP_VERSION, decodeMasterKey, unwrapDataKey, wrapDataKey };
