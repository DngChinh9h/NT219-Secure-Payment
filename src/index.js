"use strict";
require("dotenv").config();
const { validateStartupConfig } = require("./config/envValidation");

let startupConfigValidated = false;

function ensureStartupConfig() {
  if (!startupConfigValidated) {
    validateStartupConfig();
    startupConfigValidated = true;
  }
}

if (require.main === module) {
  ensureStartupConfig();
}

const express = require("express");
const cors = require("cors");
const { createCorsOptions } = require("./config/corsConfig");
const {
  securityHeaders,
  sensitiveNoStore,
} = require("./gateway/securityHeaders");
const app = express();
const { generalLimiter } = require("./gateway/rateLimiter");
const { getLiveness } = require("./health/healthController");

function parseTrustProxy(value) {
  if (!value) return null;
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue >= 0) {
    return numericValue > 0 ? numericValue : false;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function configureTrustProxy(application) {
  const configuredTrustProxy =
    parseTrustProxy(process.env.TRUST_PROXY_HOPS) ??
    parseTrustProxy(process.env.TRUST_PROXY);

  if (configuredTrustProxy !== null) {
    application.set("trust proxy", configuredTrustProxy);
  } else if (process.env.NODE_ENV === "production") {
    application.set("trust proxy", 1);
  }
}

configureTrustProxy(app);

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(sensitiveNoStore);
app.use(cors(createCorsOptions()));

app.use((req, res, next) => {
  if (req.path === "/api/payments/webhook") return next();
  express.json()(req, res, next);
});

app.use("/api", generalLimiter);

app.get("/", (req, res) => {
  res.json({
    name: "NT219 Secure Payment API",
    status: "ok",
    health: "/health",
  });
});

app.use("/api/auth", require("./auth/authRoutes"));
app.use("/api/config", require("./config/configRoutes"));
app.use("/api/health", require("./health/healthRoutes"));
app.use("/api/orders", require("./orders/orderRoutes"));
app.use("/api/payments", require("./payments/paymentRoutes"));
app.use("/api/refund-requests", require("./refunds/refundRequestRoutes"));
app.use("/api/admin/security", require("./security/securityRoutes"));
app.use("/api/admin", require("./admin/adminOperationsRoutes"));
app.use("/api/admin", require("./refunds/adminRefundRequestRoutes"));
app.use("/api/transactions", require("./transactions/transactionRoutes"));

app.get("/health", getLiveness);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  if (status >= 500) console.error(err.stack);
  res.status(status).json({
    error: err.statusCode ? err.message : "Internal server error",
  });
});

const PORT = process.env.PORT || 3000;

function startServer() {
  ensureStartupConfig();
  return app.listen(PORT, () => {
    console.log("NT219 Secure Payment API service started");
    console.log(`- port: ${PORT}`);
    console.log(`- NODE_ENV: ${process.env.NODE_ENV || "development"}`);
    console.log("- health path: /health");
    console.log("- readiness path: /api/health/readiness");
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
