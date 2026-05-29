'use strict';
    const jwt  = require('jsonwebtoken');
    const fs   = require('fs');
    const path = require('path');
    
    // Đọc key từ file lúc khởi động — fail fast nếu file không tồn tại
    // Deploy global: set JWT_PRIVATE_KEY_PATH và JWT_PUBLIC_KEY_PATH trong .env
    let PRIVATE_KEY, PUBLIC_KEY;
    try {
      const privatePath =
        process.env.JWT_PRIVATE_KEY_PATH ||
        path.join(__dirname, '../../keys/private.pem');

      const publicPath =
        process.env.JWT_PUBLIC_KEY_PATH ||
        path.join(__dirname, '../../keys/public.pem');

      PRIVATE_KEY = fs.readFileSync(privatePath);
      PUBLIC_KEY  = fs.readFileSync(publicPath);
    } catch (err) {
      console.error('RSA keys not found:', err.message);
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