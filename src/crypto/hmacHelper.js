const crypto = require('crypto');

const HMAC_SECRET = process.env.HMAC_SECRET;

function hmacSign(payload) {
  const data = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

function hmacVerify(payload, signature) {
  const expected = hmacSign(payload);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hmacSign, hmacVerify };