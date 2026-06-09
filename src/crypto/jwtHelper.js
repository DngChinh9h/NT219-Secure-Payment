"use strict";

const jwt = require("jsonwebtoken");
const { loadJwtSigningKeys } = require("./keyLoader");

let PRIVATE_KEY;
let PUBLIC_KEY;

try {
  const keys = loadJwtSigningKeys();
  PRIVATE_KEY = keys.privateKey;
  PUBLIC_KEY = keys.publicKey;

  if (!PRIVATE_KEY || !PUBLIC_KEY) {
    throw new Error("missing private or public key");
  }
} catch (err) {
  console.error("ES512 JWT signing keys not found:", err.message);
  if (process.env.NODE_ENV === "production") process.exit(1);
}

function signJWT(payload) {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: "ES512",
    expiresIn: "15m",
    issuer: "payment-system",
    audience: "payment-api",
  });
}

function verifyJWT(token) {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["ES512"],
    issuer: "payment-system",
    audience: "payment-api",
  });
}

module.exports = { signJWT, verifyJWT };
