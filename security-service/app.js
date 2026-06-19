"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const { getJwtKeys, getActiveReceiptSigningKey, getReceiptKeyStatus, getReceiptPublicKey, rotateReceiptSigningKey } = require("./keyStore");
const { decodeMasterKey, unwrapDataKey, wrapDataKey } = require("./kmsService");

const JWT_OPTIONS = Object.freeze({ algorithm: "ES512", expiresIn: "15m", issuer: "payment-system", audience: "payment-api" });
const RECEIPT_ISSUER = "payment-system";
const RECEIPT_AUDIENCE = "payment-receipt";

function clientCertificateRequired(req, res, next) {
  if (!req.client?.authorized) return res.status(401).json({ error: "Valid client certificate required" });
  return next();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error(`${label} must be an object`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function buildJwtPayload(input) {
  const payload = requireObject(input, "payload");
  if (!payload.userId || !payload.email || !payload.role) {
    const error = new Error("JWT payload must include userId, email, and role");
    error.statusCode = 400;
    throw error;
  }
  return { userId: String(payload.userId), email: String(payload.email), role: String(payload.role) };
}

function validateReceiptPayload(input) {
  const payload = requireObject(input, "receipt payload");
  const required = [
    "receipt_id", "order_id", "transaction_id", "payer_user_id", "merchant_id",
    "provider", "provider_payment_id", "amount", "currency", "status",
    "order_items_hash", "issued_at", "issuer", "audience",
  ];
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      const error = new Error(`Receipt payload missing ${field}`);
      error.statusCode = 400;
      throw error;
    }
  }
  return payload;
}

function createSecurityApp({ env = process.env } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(clientCertificateRequired);

  app.get("/internal/health", (req, res) => res.status(200).json({ status: "ok", mtls: true }));

  app.get("/internal/keys/public", (req, res, next) => {
    try {
      const { publicKey } = getJwtKeys(env);
      const receipt = getReceiptKeyStatus(env);
      return res.status(200).json({
        jwt: { algorithm: "ES512", publicKey },
        receipt: {
          ...receipt,
          publicKeys: receipt.availableKeyVersions.map((keyVersion) => ({ keyVersion, publicKey: getReceiptPublicKey(keyVersion, env) })),
        },
      });
    } catch (err) { return next(err); }
  });

  app.post("/internal/sign-jwt", (req, res, next) => {
    try {
      const { privateKey } = getJwtKeys(env);
      const token = jwt.sign(buildJwtPayload(req.body?.payload), privateKey, JWT_OPTIONS);
      return res.status(200).json({ token, algorithm: "ES512" });
    } catch (err) { return next(err); }
  });

  app.post("/internal/sign-receipt", (req, res, next) => {
    try {
      const payload = validateReceiptPayload(req.body?.payload);
      const activeKey = getActiveReceiptSigningKey(env);
      const jws = jwt.sign({ ...payload, key_version: activeKey.keyVersion }, activeKey.privateKey, {
        algorithm: "ES512", issuer: RECEIPT_ISSUER, audience: RECEIPT_AUDIENCE, keyid: String(activeKey.keyVersion), noTimestamp: true,
      });
      return res.status(200).json({ jws, keyVersion: activeKey.keyVersion, algorithm: "ES512" });
    } catch (err) { return next(err); }
  });

  app.post("/internal/verify-receipt", (req, res, next) => {
    try {
      const jws = req.body?.jws;
      if (!jws || typeof jws !== "string") {
        const error = new Error("jws is required");
        error.statusCode = 400;
        throw error;
      }
      const decoded = jwt.decode(jws, { complete: true });
      if (!decoded || typeof decoded !== "object") throw new Error("Invalid receipt");
      const keyVersion = Number(decoded.payload?.key_version || decoded.header?.kid || 1);
      const payload = jwt.verify(jws, getReceiptPublicKey(keyVersion, env), {
        algorithms: ["ES512"], issuer: RECEIPT_ISSUER, audience: RECEIPT_AUDIENCE,
      });
      return res.status(200).json({ valid: true, payload });
    } catch (err) {
      if (err.statusCode === 400) return next(err);
      return res.status(200).json({ valid: false, error: "Invalid receipt" });
    }
  });

  app.post("/internal/wrap-key", (req, res, next) => {
    try {
      const dataKey = Buffer.from(req.body?.dataKey || "", "base64");
      const masterKey = decodeMasterKey(env.KMS_MASTER_KEY);
      try {
        const wrappedDataKey = wrapDataKey(dataKey, masterKey);
        return res.status(200).json({ wrappedDataKey, algorithm: "AES-256-GCM" });
      } finally { dataKey.fill(0); masterKey.fill(0); }
    } catch (err) { return next(err); }
  });

  app.post("/internal/unwrap-key", (req, res, next) => {
    try {
      const masterKey = decodeMasterKey(env.KMS_MASTER_KEY);
      try {
        const dataKey = unwrapDataKey(req.body?.wrappedDataKey, masterKey);
        try {
          return res.status(200).json({ dataKey: dataKey.toString("base64") });
        } finally { dataKey.fill(0); }
      } finally { masterKey.fill(0); }
    } catch (err) { return next(err); }
  });

  app.post("/internal/rotate-receipt-key", (req, res, next) => {
    try { return res.status(200).json(rotateReceiptSigningKey(env)); }
    catch (err) { return next(err); }
  });

  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: status >= 500 ? "Security Service operation failed" : err.message });
  });
  return app;
}

module.exports = { JWT_OPTIONS, RECEIPT_AUDIENCE, RECEIPT_ISSUER, createSecurityApp };
