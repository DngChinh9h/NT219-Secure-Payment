'use strict';
    const db   = require('../db');
    const bcrypt = require('bcryptjs');
    
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
    
    async function createUser({ email, password, role = 'customer' }) {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await db.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id, email, role, created_at`,
        [email, passwordHash, role]
      );
      return result.rows[0];
    }
    
    async function verifyPassword(plainPassword, passwordHash) {
      return bcrypt.compare(plainPassword, passwordHash);
    }
    
    module.exports = { findByEmail, findById, createUser, verifyPassword };