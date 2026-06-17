'use strict';
const crypto = require('crypto');

// Đọc secret từ env — không hardcode
const HMAC_SECRET = process.env.HMAC_SECRET;

/**
 * Ký payload — trả về hex string signature
 * @param {object|string} payload
 * @returns {string} hex signature
 */
function hmacSign(payload) {
  if (!HMAC_SECRET) throw new Error('HMAC_SECRET not configured');
  const data = typeof payload === 'object'
    ? JSON.stringify(payload)
    : String(payload);
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(data)
    .digest('hex');
}

/**
 * Xác minh signature — trả về boolean
 * Dùng timingSafeEqual để chống timing attack
 * @param {object|string} payload
 * @param {string} signature — hex string
 * @returns {boolean}
 */
function hmacVerify(payload, signature) {
  try {
    const expected = hmacSign(payload);
    const a = Buffer.from(expected,  'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { hmacSign, hmacVerify };