'use strict';
    const crypto = require('crypto');
    
    // Master Key — trong production là SoftHSM2/AWS KMS, không bao giờ rời HSM
    const MASTER_KEY = Buffer.from(process.env.KMS_MASTER_KEY, 'hex');
    
    if (MASTER_KEY.length !== 32) {
      throw new Error('KMS_MASTER_KEY must be 64 hex chars (32 bytes)');
    }
    
    /**
     * Sinh Data Key ngẫu nhiên 32 bytes
     *
     * @returns {{ plaintext: Buffer, wrapped: string }}
     *   - plaintext: dùng để aesEncrypt(), KHÔNG lưu, chỉ dùng trong memory
     *   - wrapped:   lưu vào DB cạnh ciphertext
     *
     * Flow Envelope Encryption:
     *   1. Gọi generateDataKey()
     *   2. Dùng plaintext → aesEncrypt(data, plaintext)
     *   3. Lưu DB: { ciphertext, iv, authTag, wrappedDataKey: wrapped }
     *   4. Xóa plaintext khỏi memory
     */
    function generateDataKey() {
      const plaintext = crypto.randomBytes(32);
    
      // Wrap = mã hóa Data Key bằng Master Key
      const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        MASTER_KEY,
        Buffer.alloc(16) // IV cố định cho key wrapping (RFC 3394 simplification)
      );
      const wrapped = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
      ]);
    
      return { plaintext, wrapped: wrapped.toString('hex') };
    }
    
    /**
     * Unwrap Data Key từ DB để dùng decrypt
     *
     * @param {string} wrappedHex — lấy từ DB (field wrapped_data_key)
     * @returns {Buffer} Data Key plaintext (32 bytes)
     */
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