"use strict";

const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");

/* =========================
   Trust Root CA
========================= */

const CA_CERT = fs.readFileSync(path.join(__dirname, "../../certs/rootCA.crt"));

/* HTTPS agent */

const httpsAgent = new https.Agent({
  ca: CA_CERT,
});

/* =========================
   Generate Data Key
========================= */

async function generateDataKey() {
  try {
    const response = await axios.post(
      "https://localhost:4000/generate-key",

      {},

      {
        httpsAgent,

        headers: {
          "x-api-key": process.env.KMS_API_KEY,
        },

        timeout: 3000,
      },
    );

    return {
      plaintext: Buffer.from(response.data.plaintext, "hex"),

      wrapped: response.data.wrapped,
    };
  } catch (err) {
    throw new Error("KMS generate-key failed");
  }
}

/* =========================
   Unwrap Data Key
========================= */

async function unwrapDataKey(wrappedHex) {
  try {
    const response = await axios.post(
      "https://localhost:4000/unwrap-key",

      {
        wrapped: wrappedHex,
      },

      {
        httpsAgent,

        headers: {
          "x-api-key": process.env.KMS_API_KEY,
        },

        timeout: 3000,
      },
    );

    return Buffer.from(response.data.plaintext, "hex");
  } catch (err) {
    throw new Error("KMS unwrap-key failed");
  }
}

module.exports = {
  generateDataKey,
  unwrapDataKey,
};
generateDataKey;
