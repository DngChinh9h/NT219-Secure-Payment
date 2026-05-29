"use strict";

const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

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
function createSignedReceipt({ txId, orderId, userId, amount, currency, last4 }) {
  const payload = {
    type: "payment_receipt",
    txId,
    orderId,
    userId,
    amount,
    currency,
    last4: last4 || null,
    issuedAt: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: "RS256",
    issuer: "payment-system",
    audience: "payment-receipt",
  });
}

/**
 * Verify JWS receipt
 */
function verifyReceipt(jws) {
  return jwt.verify(jws, PUBLIC_KEY, {
    algorithms: ["RS256"],
    issuer: "payment-system",
    audience: "payment-receipt",
  });
}

module.exports = { createSignedReceipt, verifyReceipt };
