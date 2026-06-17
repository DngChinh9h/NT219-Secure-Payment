'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
/**
     * Mã hóa plaintext bằng AES-256-GCM
     *
     * @param {string} plaintext — dữ liệu cần mã hóa
     * @param {Buffer} keyBuffer — 32 bytes key (từ KMS Data Key, không phải env var)
     * @returns {{ iv: string, authTag: string, ciphertext: string }} — tất cả hex
     *
     * Lưu cả 3 field này vào DB — cần đủ 3 để decrypt
     */
    function aesEncrypt(plaintext, keyBuffer) {
      if (!keyBuffer || keyBuffer.length !== 32) {
        throw new Error('Key must be exactly 32 bytes (256-bit)');
      }
      const iv = crypto.randomBytes(12); // GCM chuẩn: 12 bytes IV, PHẢI random mỗi lần
      const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
    
      return {
        iv:         iv.toString('hex'),           // 24 hex chars
        authTag:    cipher.getAuthTag().toString('hex'), // 32 hex chars
        ciphertext: encrypted
      };
    }
    
    /**
     * Giải mã — nhận object từ aesEncrypt và keyBuffer
     * Throw Error nếu authTag sai (ciphertext bị sửa đổi)
     *
     * @param {{ iv: string, authTag: string, ciphertext: string }} encryptedObj
     * @param {Buffer} keyBuffer — 32 bytes, phải là key giống lúc encrypt
     * @returns {string} plaintext
     */
    function aesDecrypt({ iv, authTag, ciphertext }, keyBuffer) {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        keyBuffer,
        Buffer.from(iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8'); // Throw nếu authTag không khớp
      return decrypted;
    }
    
    module.exports = { aesEncrypt, aesDecrypt };