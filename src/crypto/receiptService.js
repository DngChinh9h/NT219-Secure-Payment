"use strict";

const jwt = require("jsonwebtoken");
const signingKeyService = require("./receiptSigningKeyService");
const { loadJwtSigningKeys } = require("./keyLoader");

let PRIVATE_KEY;
let PUBLIC_KEY;

try {
  const keys = loadJwtSigningKeys();
  PRIVATE_KEY = keys.privateKey;
  PUBLIC_KEY = keys.publicKey;
} catch (err) {
  console.error("Receipt service: ES512 signing keys not found:", err.message);
}

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
    algorithm: "ES512",
    issuer: "payment-system",
    audience: "payment-receipt",
    keyid: String(keyVersion),
  });
}

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

  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error("Invalid receipt signing key version");
  }

  const storedPublicKey = await signingKeyService.getPublicKeyForVersion(keyVersion);
  const publicKey =
    storedPublicKey ||
    (keyVersion === signingKeyService.LEGACY_KEY_VERSION ? PUBLIC_KEY : null);

  if (!publicKey) {
    throw new Error(`Unknown receipt signing key version: ${keyVersion}`);
  }

  return jwt.verify(jws, publicKey, {
    algorithms: ["ES512"],
    issuer: "payment-system",
    audience: "payment-receipt",
  });
}

function isReceiptSigningEnabled() {
  return Boolean(PRIVATE_KEY && PUBLIC_KEY);
}

async function getReceiptSigningStatus() {
  const keyStatus = await signingKeyService.getKeyStatus();
  const hasUsableStoredKey =
    keyStatus.keyRotationEnabled &&
    keyStatus.keys.some((key) => key.active);

  return {
    receiptSigningEnabled: isReceiptSigningEnabled() || hasUsableStoredKey,
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
