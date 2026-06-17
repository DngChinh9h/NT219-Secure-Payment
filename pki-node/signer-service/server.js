"use strict";

require("dotenv").config();

const express = require("express");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");
const https = require("https");

const app = express();

/* =========================
   Load JWT Signing Key
   (Dùng để ký JWT)
========================= */

const PRIVATE_KEY_PATH = path.join(__dirname, "keys", "private.pem");

const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

/* =========================
   Load TLS Certificate
   (Dùng cho HTTPS)
========================= */

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "signer.key")),

  cert: fs.readFileSync(path.join(__dirname, "certs", "signer.crt")),
};

/* =========================
   Middleware
========================= */

app.use(express.json());

/*
   Chỉ backend mới được gọi /sign
*/

app.use((req, res, next) => {
  /* health check không cần auth */

  if (req.path === "/health") {
    return next();
  }

  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      error: "Missing API Key",
    });
  }

  if (apiKey !== process.env.SIGNER_API_KEY) {
    return res.status(403).json({
      error: "Unauthorized",
    });
  }

  next();
});

/* =========================
   Sign JWT
========================= */

app.post("/sign", (req, res) => {
  try {
    const payload = req.body.payload;

    if (!payload) {
      return res.status(400).json({
        error: "Payload is required",
      });
    }

    const token = jwt.sign(payload, PRIVATE_KEY, {
      algorithm: "ES512",
      expiresIn: "15m",
      issuer: "payment-system",
      audience: "payment-api",
    });

    return res.json({
      token,
    });
  } catch (err) {
    console.error("JWT signing error:", err.message);

    return res.status(500).json({
      error: "Failed to sign JWT",
    });
  }
});

/* =========================
   Health Check
========================= */

app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    service: "signer-service",
  });
});

/* =========================
   Start HTTPS Server
========================= */

const PORT = 5000;

https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`Signer HTTPS running on port ${PORT}`);
});
