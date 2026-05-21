'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function aesEncrypt(plaintext, keyBuffer) {
  if (!keyBuffer || keyBuffer.length !== 32) {
    throw new Error('Key must be exactly 32 bytes (256-bit)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    iv:         iv.toString('hex'),
    authTag:    cipher.getAuthTag().toString('hex'),
    ciphertext: encrypted
  };
}

function aesDecrypt({ iv, authTag, ciphertext }, keyBuffer) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    keyBuffer,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { aesEncrypt, aesDecrypt };