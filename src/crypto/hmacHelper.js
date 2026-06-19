"use strict";

const crypto = require("crypto");

function getMacSecret() {
  if (!process.env.HMAC_SECRET) {
    throw new Error("HMAC_SECRET not configured");
  }
  return process.env.HMAC_SECRET;
}

/**
 * Compute an HMAC-SHA256 message authentication code.
 * HMAC provides integrity and authenticity for shared-secret systems; it is not
 * a digital signature and does not provide non-repudiation.
 */
function computeMac(payload) {
  const data = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
  return crypto.createHmac("sha256", getMacSecret()).update(data).digest("hex");
}

function verifyMac(payload, mac) {
  try {
    const expected = computeMac(payload);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(mac, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Backward-compatible aliases for older modules/tests. New code should use the
// MAC terminology above.
const hmacSign = computeMac;
const hmacVerify = verifyMac;

module.exports = {
  computeMac,
  verifyMac,
  hmacSign,
  hmacVerify,
};
