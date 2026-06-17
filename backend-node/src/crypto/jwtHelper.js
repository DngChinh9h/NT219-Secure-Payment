"use strict";

const jwt = require("jsonwebtoken");
const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { loadPublicKey } = require("./keyLoader");

/* =========================
   Public key verify JWT
========================= */

const PUBLIC_KEY = loadPublicKey();

/* =========================
   Trust Root CA
========================= */

const CA_CERT = fs.readFileSync(path.join(__dirname, "../../certs/rootCA.crt"));

const httpsAgent = new https.Agent({
  ca: CA_CERT,
});

/* =========================
   Request signer-service
========================= */

async function signJWT(payload) {
  try {
    const response = await axios.post(
      "https://localhost:5000/sign",

      {
        payload,
      },

      {
        httpsAgent,

        headers: {
          "x-api-key": process.env.SIGNER_API_KEY,
        },

        timeout: 3000,
      },
    );

    return response.data.token;
  } catch (err) {
    throw new Error("JWT signer service unavailable");
  }
}

/* =========================
   Verify JWT locally
========================= */

function verifyJWT(token) {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["ES512"],
    issuer: "payment-system",
    audience: "payment-api",
  });
}

module.exports = {
  signJWT,
  verifyJWT,
};
