/**
     * Entry point duy nhất cho Crypto module
     * TV1 và TV3 chỉ import từ file này
     *
     * Usage:
     *   const { hmacSign, aesEncrypt, verifyJWT, validate, loginSchema } = require('../crypto');
     */
    module.exports = {
      // HMAC
      ...require('./hmacHelper'),     // hmacSign, hmacVerify
    
      // AES
      ...require('./aesHelper'),      // aesEncrypt, aesDecrypt
    
      // JWT
      ...require('./jwtHelper'),      // signJWT, verifyJWT
    
      // Nonce
      ...require('./nonceValidator'), // validateNonce
    
      // Input Validation
      ...require('./inputValidator'), // validate, registerSchema, loginSchema, orderSchema, paymentSchema
    
      // Receipt JWS
      ...require('./receiptService'), // createSignedReceipt, verifyReceipt
    };