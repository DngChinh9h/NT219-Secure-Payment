"use strict";

const jwt = require("jsonwebtoken");
const { loadJwtPublicKey } = require("./keyLoader");

function verifyJWT(token, { publicKey, env = process.env } = {}) {
  return jwt.verify(token, publicKey || loadJwtPublicKey(env), {
    algorithms: ["ES512"],
    issuer: "payment-system",
    audience: "payment-api",
  });
}

module.exports = { verifyJWT };
