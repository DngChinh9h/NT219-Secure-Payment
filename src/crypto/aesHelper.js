const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const AES_KEY = Buffer.from(process.env.AES_KEY, 'hex');

function aesEncrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, AES_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted
  };
}

function aesDecrypt({ iv, authTag, ciphertext }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, AES_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

module.exports = { aesEncrypt, aesDecrypt };