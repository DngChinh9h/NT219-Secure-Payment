"use strict";

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();

app.use(express.json());

/* =========================
   TLS certificate
========================= */

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "kms.key")),

  cert: fs.readFileSync(path.join(__dirname, "certs", "kms.crt")),
};

/* =========================
   Master key
========================= */

const MASTER_KEY = Buffer.from(process.env.KMS_MASTER_KEY, "hex");

if (MASTER_KEY.length !== 32) {
  throw new Error("Invalid KMS_MASTER_KEY");
}

/* =========================
   API key auth
========================= */

app.use((req, res, next) => {
  if (req.path === "/health") {
    return next();
  }

  const apiKey = req.headers["x-api-key"];

  if (apiKey !== process.env.KMS_API_KEY) {
    return res.status(403).json({
      error: "Unauthorized",
    });
  }

  next();
});

/* =========================
   Generate data key
========================= */

app.post("/generate-key", (req, res) => {
  const plaintext = crypto.randomBytes(32);

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    MASTER_KEY,
    Buffer.alloc(16),
  );

  const wrapped = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return res.json({
    plaintext: plaintext.toString("hex"),

    wrapped: wrapped.toString("hex"),
  });
});

/* =========================
   Unwrap key
========================= */

app.post("/unwrap-key", (req, res) => {
  try {
    const wrapped = req.body.wrapped;

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      MASTER_KEY,
      Buffer.alloc(16),
    );

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(wrapped, "hex")),
      decipher.final(),
    ]);

    return res.json({
      plaintext: plaintext.toString("hex"),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unwrap failed",
    });
  }
});

/* =========================
   Health
========================= */

app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    service: "kms-api",
  });
});

/* =========================
   Start HTTPS
========================= */

const PORT = 4000;

https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`KMS HTTPS running on ${PORT}`);
});
