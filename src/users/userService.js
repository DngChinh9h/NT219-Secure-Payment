'use strict';
const db = require('../db');
const bcrypt = require('bcryptjs');
const { generateDataKey, unwrapDataKey } = require('../kms/kmsService');
const { aesEncrypt, aesDecrypt } = require('../crypto');

async function findByEmail(email) {
  const result = await db.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  if (!result.rows[0]) return null;
  
  const user = result.rows[0];
  if (user.wrapped_data_key && user.encrypted_name) {
    const dataKey = unwrapDataKey(user.wrapped_data_key);
    user.fullName = aesDecrypt(user.encrypted_name, dataKey, user.name_iv, user.name_auth_tag);
    user.address = aesDecrypt(user.encrypted_address, dataKey, user.address_iv, user.address_auth_tag);
    user.cccdNumber = aesDecrypt(user.encrypted_cccd, dataKey, user.cccd_iv, user.cccd_auth_tag);
  }
  return user;
}

async function findById(userId) {
  const result = await db.query(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  if (!result.rows[0]) return null;

  const user = result.rows[0];
  if (user.wrapped_data_key && user.encrypted_name) {
    const dataKey = unwrapDataKey(user.wrapped_data_key);
    user.fullName = aesDecrypt(user.encrypted_name, dataKey, user.name_iv, user.name_auth_tag);
    user.address = aesDecrypt(user.encrypted_address, dataKey, user.address_iv, user.address_auth_tag);
    user.cccdNumber = aesDecrypt(user.encrypted_cccd, dataKey, user.cccd_iv, user.cccd_auth_tag);
  }
  
  delete user.password_hash;
  delete user.encrypted_name;
  delete user.name_iv;
  delete user.name_auth_tag;
  delete user.encrypted_address;
  delete user.address_iv;
  delete user.address_auth_tag;
  delete user.encrypted_cccd;
  delete user.cccd_iv;
  delete user.cccd_auth_tag;
  delete user.wrapped_data_key;

  return user;
}

async function createUser({ email, password, fullName, address, cccdNumber, role = 'customer' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const { plaintext: dataKey, wrapped } = generateDataKey();

  const encName = aesEncrypt(fullName, dataKey);
  const encAddress = aesEncrypt(address, dataKey);
  const encCccd = aesEncrypt(cccdNumber, dataKey);

  const result = await db.query(
    `INSERT INTO users (
      email, password_hash, role,
      encrypted_name, name_iv, name_auth_tag,
      encrypted_address, address_iv, address_auth_tag,
      encrypted_cccd, cccd_iv, cccd_auth_tag,
      wrapped_data_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, email, role, created_at`,
    [
      email, passwordHash, role,
      encName.ciphertext, encName.iv, encName.authTag,
      encAddress.ciphertext, encAddress.iv, encAddress.authTag,
      encCccd.ciphertext, encCccd.iv, encCccd.authTag,
      wrapped
    ]
  );
  return result.rows[0];
}

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { findByEmail, findById, createUser, verifyPassword };