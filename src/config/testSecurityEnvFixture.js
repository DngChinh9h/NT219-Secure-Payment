"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function createSecurityEnv(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nt219-security-env-"));
  const files = {
    clientCert: path.join(directory, "client.crt"),
    clientKey: path.join(directory, "client.key"),
    ca: path.join(directory, "ca.crt"),
    jwtPublic: path.join(directory, "jwt-public.pem"),
  };
  Object.values(files).forEach((filePath) => fs.writeFileSync(filePath, "test-material"));
  return {
    NODE_ENV: "production",
    PUBLIC_APP_ENV: "production",
    DATABASE_URL: "postgres://private-database",
    JWT_PUBLIC_KEY_PATH: files.jwtPublic,
    SECURITY_SERVICE_BASE_URL: "https://security-service:9443",
    SECURITY_CLIENT_CERT_PATH: files.clientCert,
    SECURITY_CLIENT_KEY_PATH: files.clientKey,
    SECURITY_CA_CERT_PATH: files.ca,
    STRIPE_SECRET_KEY: "sk_test_private",
    STRIPE_WEBHOOK_SECRET: "whsec_private",
    STRIPE_PUBLISHABLE_KEY: "pk_test_public",
    CORS_ORIGINS: "https://frontend.example",
    HMAC_SECRET: "private-hmac-secret",
    ...overrides,
  };
}

module.exports = { createSecurityEnv };
