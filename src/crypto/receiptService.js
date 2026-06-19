"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const signingKeyService = require("./receiptSigningKeyService");
const { loadJwtSigningKeys } = require("./keyLoader");

const RECEIPT_ISSUER = "payment-system";
const RECEIPT_AUDIENCE = "payment-receipt";

let PRIVATE_KEY;
let PUBLIC_KEY;

try {
  const keys = loadJwtSigningKeys();
  PRIVATE_KEY = keys.privateKey;
  PUBLIC_KEY = keys.publicKey;
} catch (err) {
  console.error("Receipt service: ES512 signing keys not found:", err.message);
}

function normalizeReceiptPayload(input) {
  const receiptId = input.receiptId || input.receipt_id || crypto.randomUUID();
  const transactionId = input.transactionId || input.transaction_id || input.txId;
  const payerUserId = input.payerUserId || input.payer_user_id || input.userId;
  const merchantId = input.merchantId || input.merchant_id;
  const providerPaymentId =
    input.providerPaymentId || input.provider_payment_id || input.paymentIntentId;
  const orderItemsHash = input.orderItemsHash || input.order_items_hash;

  return {
    type: "payment_receipt",
    receipt_id: receiptId,
    order_id: input.orderId || input.order_id,
    transaction_id: transactionId,
    payer_user_id: payerUserId,
    merchant_id: merchantId,
    payee_id: merchantId,
    provider: input.provider || "stripe",
    provider_payment_id: providerPaymentId,
    amount: Number(input.amount),
    currency: String(input.currency || "vnd").toLowerCase(),
    status: input.status || "PAID",
    order_items_hash: orderItemsHash,
    issued_at: new Date().toISOString(),
    issuer: RECEIPT_ISSUER,
    audience: RECEIPT_AUDIENCE,
    last4: input.last4 || null,

    // Backward-compatible aliases for older API consumers.
    txId: transactionId,
    orderId: input.orderId || input.order_id,
    userId: payerUserId,
  };
}

async function createSignedReceipt(input) {
  const activeKey = await signingKeyService.getActiveSigningKey();
  const privateKey = activeKey?.privateKey || PRIVATE_KEY;
  const keyVersion = activeKey?.keyVersion || signingKeyService.LEGACY_KEY_VERSION;

  if (!privateKey) {
    throw new Error("Receipt signing private key is not configured");
  }

  const payload = {
    ...normalizeReceiptPayload(input),
    key_version: keyVersion,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "ES512",
    issuer: RECEIPT_ISSUER,
    audience: RECEIPT_AUDIENCE,
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
    issuer: RECEIPT_ISSUER,
    audience: RECEIPT_AUDIENCE,
  });
}

function isReceiptSigningEnabled() {
  return Boolean(PRIVATE_KEY && PUBLIC_KEY);
}

async function getReceiptSigningStatus() {
  const keyStatus = await signingKeyService.getKeyStatus();
  const hasUsableStoredKey =
    keyStatus.keyRotationEnabled && keyStatus.keys.some((key) => key.active);

  return {
    receiptSigningEnabled: isReceiptSigningEnabled() || hasUsableStoredKey,
    currentKeyVersion: keyStatus.activeKeyVersion,
    keyRotationEnabled: keyStatus.keyRotationEnabled,
    availableKeyVersions: keyStatus.availableKeyVersions,
  };
}

module.exports = {
  RECEIPT_AUDIENCE,
  RECEIPT_ISSUER,
  createSignedReceipt,
  verifyReceipt,
  isReceiptSigningEnabled,
  getReceiptSigningStatus,
  normalizeReceiptPayload,
};
