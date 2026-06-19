"use strict";

const crypto = require("crypto");
const { getSecurityServiceClient } = require("../security/securityServiceClient");

const RECEIPT_ISSUER = "payment-system";
const RECEIPT_AUDIENCE = "payment-receipt";

function normalizeReceiptPayload(input) {
  const receiptId = input.receiptId || input.receipt_id || crypto.randomUUID();
  const transactionId = input.transactionId || input.transaction_id || input.txId;
  const payerUserId = input.payerUserId || input.payer_user_id || input.userId;
  const merchantId = input.merchantId || input.merchant_id;
  const providerPaymentId = input.providerPaymentId || input.provider_payment_id || input.paymentIntentId;
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
    issued_at: input.issuedAt || input.issued_at || new Date().toISOString(),
    issuer: RECEIPT_ISSUER,
    audience: RECEIPT_AUDIENCE,
    last4: input.last4 || null,
    txId: transactionId,
    orderId: input.orderId || input.order_id,
    userId: payerUserId,
  };
}

async function createSignedReceipt(input) {
  const response = await getSecurityServiceClient().signReceipt(normalizeReceiptPayload(input));
  return response.jws;
}

async function verifyReceipt(jws) {
  return getSecurityServiceClient().verifyReceipt(jws);
}

function isReceiptSigningEnabled() {
  return Boolean(process.env.SECURITY_SERVICE_BASE_URL);
}

async function getReceiptSigningStatus() {
  const keys = await getSecurityServiceClient().getPublicKeys();
  return {
    receiptSigningEnabled: isReceiptSigningEnabled(),
    currentKeyVersion: keys.receipt.activeKeyVersion,
    keyRotationEnabled: true,
    availableKeyVersions: keys.receipt.availableKeyVersions,
  };
}

module.exports = {
  RECEIPT_AUDIENCE,
  RECEIPT_ISSUER,
  createSignedReceipt,
  getReceiptSigningStatus,
  isReceiptSigningEnabled,
  normalizeReceiptPayload,
  verifyReceipt,
};
