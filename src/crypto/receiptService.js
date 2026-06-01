"use strict";

const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const signingKeyService = require("./receiptSigningKeyService");

const privatePath =
  process.env.JWT_PRIVATE_KEY_PATH ||
  path.join(__dirname, "../../keys/private.pem");

const publicPath =
  process.env.JWT_PUBLIC_KEY_PATH ||
  path.join(__dirname, "../../keys/public.pem");

let PRIVATE_KEY, PUBLIC_KEY;
try {
  PRIVATE_KEY = fs.readFileSync(privatePath);
  PUBLIC_KEY = fs.readFileSync(publicPath);
} catch (err) {
  console.error("Receipt service: RSA keys not found:", err.message);
}

/**
 * Tạo JWS receipt cho transaction đã thành công
 * Dùng RS256, KHÔNG có expiresIn (receipt vĩnh viễn)
 */
async function createSignedReceipt({ txId, orderId, userId, amount, currency, last4 }) {
  const activeKey = await signingKeyService.getActiveSigningKey();
  const privateKey = activeKey?.privateKey || PRIVATE_KEY;
  const keyVersion = activeKey?.keyVersion || signingKeyService.LEGACY_KEY_VERSION;

  if (!privateKey) {
    throw new Error("Receipt signing private key is not configured");
  }

  const payload = {
    type: "payment_receipt",
    key_version: keyVersion,
    txId,
    orderId,
    userId,
    amount,
    currency,
    last4: last4 || null,
    issuedAt: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    issuer: "payment-system",
    audience: "payment-receipt",
    keyid: String(keyVersion),
  });
}

/**
 * Verify JWS receipt
 */
async function verifyReceipt(jws) {
  const decoded = jwt.decode(jws, { complete: true });

  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid receipt");
  }

  const keyVersion = Number(
    decoded.payload?.key_version ||
      decoded.header?.kid ||
      signingKeyService.LEGACY_KEY_VERSION,
  );
  const storedPublicKey = await signingKeyService.getPublicKeyForVersion(keyVersion);
  const publicKey =
    storedPublicKey ||
    (keyVersion === signingKeyService.LEGACY_KEY_VERSION ? PUBLIC_KEY : null);

  if (!publicKey) {
    throw new Error(`Unknown receipt signing key version: ${keyVersion}`);
  }

  return jwt.verify(jws, publicKey, {
    algorithms: ["RS256"],
    issuer: "payment-system",
    audience: "payment-receipt",
  });
}

function isReceiptSigningEnabled() {
  return Boolean(PRIVATE_KEY && PUBLIC_KEY);
}

async function getReceiptSigningStatus() {
  const keyStatus = await signingKeyService.getKeyStatus();

  return {
    receiptSigningEnabled: isReceiptSigningEnabled() || keyStatus.keys.length > 0,
    currentKeyVersion: keyStatus.activeKeyVersion,
    keyRotationEnabled: keyStatus.keyRotationEnabled,
    availableKeyVersions: keyStatus.availableKeyVersions,
  };
}

module.exports = {
  createSignedReceipt,
  verifyReceipt,
  isReceiptSigningEnabled,
  getReceiptSigningStatus,
};
