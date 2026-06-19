"use strict";

const { getJwtPublicKeyConfigStatus } = require("../crypto/keyLoader");
const { getSecurityClientConfigStatus } = require("../security/securityServiceClient");

const FORBIDDEN_BACKEND_ENV = Object.freeze([
  "JWT_PRIVATE_KEY_PATH",
  "JWT_PRIVATE_KEY",
  "JWT_PRIVATE_KEY_B64",
  "KMS_MASTER_KEY",
  "RECEIPT_PRIVATE_KEY_PATH",
  "RECEIPT_PRIVATE_KEY_DIR",
]);

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getConfiguredOrigins(env = process.env) {
  return (env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

function getForbiddenBackendSecrets(env = process.env) {
  return FORBIDDEN_BACKEND_ENV.filter((name) => isPresent(env[name]));
}

function getRuntimeConfigStatus({ env = process.env, checkKeyFiles = true } = {}) {
  const jwtKeys = checkKeyFiles
    ? getJwtPublicKeyConfigStatus(env)
    : { publicKeyConfigured: true };
  const securityClient = getSecurityClientConfigStatus({ env, checkFiles: checkKeyFiles });
  const configuredOrigins = getConfiguredOrigins(env);
  const checks = {
    databaseUrlPresent: isPresent(env.DATABASE_URL),
    jwtPublicKeyConfigured: jwtKeys.publicKeyConfigured,
    securityServiceConfigured: securityClient.valid,
    backendPrivateKeysAbsent: getForbiddenBackendSecrets(env).length === 0,
    stripeSecretKeyPresent: isPresent(env.STRIPE_SECRET_KEY),
    stripeWebhookSecretPresent: isPresent(env.STRIPE_WEBHOOK_SECRET),
    stripePublishableKeyPresent: isPresent(env.STRIPE_PUBLISHABLE_KEY),
    corsOriginsConfigured: configuredOrigins.length > 0,
    corsWildcardRejected: env.NODE_ENV !== "production" || !configuredOrigins.includes("*"),
    hmacSecretPresent: isPresent(env.HMAC_SECRET),
  };
  const labels = {
    databaseUrlPresent: "DATABASE_URL",
    jwtPublicKeyConfigured: "JWT_PUBLIC_KEY_PATH or SECURITY_PUBLIC_KEYS_CACHE",
    securityServiceConfigured: `Security Service mTLS (${securityClient.missing.join(", ") || "configured"})`,
    backendPrivateKeysAbsent: `backend must not define ${FORBIDDEN_BACKEND_ENV.join(", ")}`,
    stripeSecretKeyPresent: "STRIPE_SECRET_KEY",
    stripeWebhookSecretPresent: "STRIPE_WEBHOOK_SECRET",
    stripePublishableKeyPresent: "STRIPE_PUBLISHABLE_KEY",
    corsOriginsConfigured: "CORS_ORIGINS",
    corsWildcardRejected: "CORS_ORIGINS without wildcard in production",
    hmacSecretPresent: "HMAC_SECRET",
  };
  const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => labels[name]);
  return {
    valid: missing.length === 0,
    environment: env.PUBLIC_APP_ENV || env.NODE_ENV || "development",
    checks,
    missing,
    securityClient: securityClient.checks,
    adminSeed: {
      adminEmailPresent: isPresent(env.ADMIN_EMAIL),
      adminPasswordPresent: isPresent(env.ADMIN_PASSWORD),
      adminFullNamePresent: isPresent(env.ADMIN_FULL_NAME),
      adminAddressPresent: isPresent(env.ADMIN_ADDRESS),
      adminCccdNumberPresent: isPresent(env.ADMIN_CCCD_NUMBER),
      adminResetPassword: env.ADMIN_RESET_PASSWORD === "true",
    },
  };
}

function logStartupDiagnostics(status, logger = console) {
  logger.log("Runtime config diagnostics:");
  for (const [name, present] of Object.entries(status.checks)) logger.log(`- ${name}: ${present ? "yes" : "no"}`);
  logger.log(`- securityServiceMtlsConfigured: ${status.checks.securityServiceConfigured ? "yes" : "no"}`);
  logger.log(`- adminSeedConfigured: ${status.adminSeed.adminEmailPresent && status.adminSeed.adminPasswordPresent ? "yes" : "no"}`);
}

function validateStartupConfig({ env = process.env, logger = console, failFast = env.NODE_ENV === "production" } = {}) {
  const status = getRuntimeConfigStatus({ env });
  logStartupDiagnostics(status, logger);
  if (!status.valid) {
    const err = new Error(`Required runtime config is incomplete: ${status.missing.join(", ")}`);
    if (failFast) throw err;
    logger.warn(err.message);
  }
  return status;
}

module.exports = {
  FORBIDDEN_BACKEND_ENV,
  getForbiddenBackendSecrets,
  getRuntimeConfigStatus,
  isPresent,
  logStartupDiagnostics,
  validateStartupConfig,
};
