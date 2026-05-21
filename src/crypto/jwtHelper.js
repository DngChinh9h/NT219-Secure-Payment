'use strict';
const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const path = require('path');

let PRIVATE_KEY, PUBLIC_KEY;
try {
  PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '../../keys/private.pem'));
  PUBLIC_KEY  = fs.readFileSync(path.join(__dirname, '../../keys/public.pem'));
} catch (err) {
  console.error('❌ RSA keys not found.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

function signJWT(payload) {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer:    'payment-system',
    audience:  'payment-api'
  });
}

function verifyJWT(token) {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ['RS256'],
    issuer:    'payment-system',
    audience:  'payment-api'
  });
}

module.exports = { signJWT, verifyJWT };