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

const configuredTrustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
if (Number.isInteger(configuredTrustProxyHops) && configuredTrustProxyHops > 0) {
  app.set("trust proxy", configuredTrustProxyHops);
} else if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(sensitiveNoStore);
app.use(cors(createCorsOptions()));

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  require("./payments/webhookHandler").handleWebhook
);

app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhook") return next();
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
  return app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
