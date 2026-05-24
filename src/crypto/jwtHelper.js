'use strict';
    const jwt  = require('jsonwebtoken');
    const fs   = require('fs');
    const path = require('path');
    
    // Đọc key từ file lúc khởi động — fail fast nếu file không tồn tại
    let PRIVATE_KEY, PUBLIC_KEY;
    try {
      PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '../../keys/private.pem'));
      PUBLIC_KEY  = fs.readFileSync(path.join(__dirname, '../../keys/public.pem'));
    } catch (err) {
      console.error('❌ RSA keys not found. Run: openssl genrsa -out keys/private.pem 2048');
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
    
    /**
     * Ký JWT bằng private key RS256
     * Chỉ Auth Service gọi hàm này
     *
     * @param {{ userId: string, email: string, role: string }} payload
     * @returns {string} JWT token
     */
    function signJWT(payload) {
      return jwt.sign(payload, PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: '15m',          // Access token ngắn hạn
        issuer:    'payment-system',
        audience:  'payment-api'
      });
    }
    
    /**
     * Verify JWT bằng public key
     * Gateway và các service gọi hàm này
     *
     * @param {string} token
     * @returns {object} decoded payload
     * @throws Error nếu hết hạn, sai chữ ký, hoặc alg khác RS256
     */
    function verifyJWT(token) {
      return jwt.verify(token, PUBLIC_KEY, {
        algorithms: ['RS256'],     // QUAN TRỌNG: chỉ chấp nhận RS256, chặn alg:none
        issuer:    'payment-system',
        audience:  'payment-api'
      });
    }
    
    module.exports = { signJWT, verifyJWT };