"use strict";

const crypto = require("crypto");
const db = require("../db");

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

function createError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getWindowMs() {
  const configured = Number(process.env.REQUEST_NONCE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_WINDOW_MS;
}

function validateTimestamp(timestamp, now = Date.now()) {
  if (!timestamp) {
    throw createError("Missing nonce or timestamp", 400);
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw createError("Invalid timestamp", 400);
  }

  if (Math.abs(now - ts) > getWindowMs()) {
    throw createError("Request expired or timestamp is too far from server time", 400);
  }

  return ts;
}

function hashRequest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value || {}))
    .digest("hex");
}

async function consumeNonce({
  userId,
  nonce,
  requestType,
  timestamp,
  requestBody,
  queryable = db,
}) {
  if (!userId || !nonce || !requestType) {
    throw createError("Missing nonce or timestamp", 400);
  }

  validateTimestamp(timestamp);
  const requestHash = hashRequest(requestBody);
  const expiresAt = new Date(Date.now() + getWindowMs());

  try {
    const result = await queryable.query(
      `INSERT INTO request_nonces
        (user_id, nonce, request_type, request_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, nonce, requestType, requestHash, expiresAt.toISOString()],
    );

    return {
      valid: true,
      nonce: result.rows[0],
      requestHash,
    };
  } catch (err) {
    if (err.code === "23505") {
      throw createError("Replay attack detected: nonce already used", 409);
    }
    throw err;
  }
}

module.exports = {
  DEFAULT_WINDOW_MS,
  consumeNonce,
  hashRequest,
  validateTimestamp,
};
