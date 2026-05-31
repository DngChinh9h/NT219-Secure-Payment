'use strict';
    const db   = require('../db');
    const bcrypt = require('bcryptjs');
    const { encryptUserPII } = require('./piiService');
    const BCRYPT_ROUNDS = 12;
    
    async function findByEmail(email) {
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 LIMIT 1',
        [email]
      );
      return result.rows[0] || null;
    }
    
    async function findById(userId) {
      const result = await db.query(
        'SELECT id, email, role, created_at FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
      return result.rows[0] || null;
    }
    
    async function hashPassword(password) {
      return bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    async function createUser({ email, password, fullName, address, cccdNumber, role = 'customer' }) {
      const passwordHash = await hashPassword(password);

      // Mã hóa PII nếu có (bắt buộc trong registerSchema)
      const pii = encryptUserPII({ fullName, address, cccdNumber });

      const result = await db.query(
        `INSERT INTO users (
           email, password_hash, role,
           encrypted_name, name_iv, name_auth_tag,
           encrypted_address, address_iv, address_auth_tag,
           encrypted_cccd, cccd_iv, cccd_auth_tag,
           wrapped_data_key
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, email, role, created_at`,
        [
          email, passwordHash, role,
          pii.encrypted_name, pii.name_iv, pii.name_auth_tag,
          pii.encrypted_address, pii.address_iv, pii.address_auth_tag,
          pii.encrypted_cccd, pii.cccd_iv, pii.cccd_auth_tag,
          pii.wrapped_data_key
        ]
      );
      return result.rows[0];
    }
    
    async function verifyPassword(plainPassword, passwordHash) {
      return bcrypt.compare(plainPassword, passwordHash);
    }
    
    module.exports = { findByEmail, findById, createUser, verifyPassword, hashPassword };
