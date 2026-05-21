'use strict';
const crypto = require('crypto');

const MASTER_KEY = Buffer.from(process.env.KMS_MASTER_KEY, 'hex');

if (MASTER_KEY.length !== 32) {
  throw new Error('KMS_MASTER_KEY must be 64 hex chars (32 bytes)');
}

function generateDataKey() {
  const plaintext = crypto.randomBytes(32);

  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    MASTER_KEY,
    Buffer.alloc(16)
  );
  const wrapped = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);

  return { plaintext, wrapped: wrapped.toString('hex') };
}

function unwrapDataKey(wrappedHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    MASTER_KEY,
    Buffer.alloc(16)
  );
  return Buffer.concat([
    decipher.update(Buffer.from(wrappedHex, 'hex')),
    decipher.final()
  ]);
}

module.exports = { generateDataKey, unwrapDataKey };