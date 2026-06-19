"use strict";

const {
  DEFAULT_PRIVATE_KEY_PATH,
  DEFAULT_PUBLIC_KEY_PATH,
  getJwtKeyConfigStatus,
} = require("../crypto/keyLoader");

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getConfiguredOrigins(env = process.env) {
  return (env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isValidKmsMasterKey(value) {
  if (!isPresent(value)) return false;
  if (/^[a-fA-F0-9]{64}$/.test(value.trim())) return true;
  try {
    return Buffer.from(value.trim(), "base64").length === 32;
  } catch {
    return false;
  }
}

function getRuntimeConfigStatus({
  env = process.env,
  checkKeyFiles = true,
} = {}) {
  const jwtKeys = checkKeyFiles
    ? getJwtKeyConfigStatus(env)
    : { privateKeyConfigured: true, publicKeyConfigured: true };
  const configuredOrigins = getConfiguredOrigins(env);
  const corsWildcardConfigured = configuredOrigins.includes("*");
  const checks = {
    databaseUrlPresent: isPresent(env.DATABASE_URL),
    jwtPrivateKeyConfigured: jwtKeys.privateKeyConfigured,
    jwtPublicKeyConfigured: jwtKeys.publicKeyConfigured,
    stripeSecretKeyPresent: isPresent(env.STRIPE_SECRET_KEY),
    stripeWebhookSecretPresent: isPresent(env.STRIPE_WEBHOOK_SECRET),
    stripePublishableKeyPresent: isPresent(env.STRIPE_PUBLISHABLE_KEY),
    corsOriginsConfigured: configuredOrigins.length > 0,
    corsWildcardRejected:
      env.NODE_ENV !== "production" || !corsWildcardConfigured,
    hmacSecretPresent: isPresent(env.HMAC_SECRET),
    kmsMasterKeyPresent: isValidKmsMasterKey(env.KMS_MASTER_KEY),
  };
  const labels = {
    databaseUrlPresent: "DATABASE_URL",
    jwtPrivateKeyConfigured:
      "JWT private key configured via path, base64, or raw env",
    jwtPublicKeyConfigured:
      "JWT public key configured via path, base64, or raw env",
    stripeSecretKeyPresent: "STRIPE_SECRET_KEY",
    stripeWebhookSecretPresent: "STRIPE_WEBHOOK_SECRET",
    stripePublishableKeyPresent: "STRIPE_PUBLISHABLE_KEY",
    corsOriginsConfigured: "CORS_ORIGINS",
    corsWildcardRejected: "CORS_ORIGINS without wildcard in production",
    hmacSecretPresent: "HMAC_SECRET",
    kmsMasterKeyPresent: "KMS_MASTER_KEY as 32 bytes encoded hex or base64",
  };
  const missing = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([name]) => labels[name]);

  return {
    valid: missing.length === 0,
    environment: env.PUBLIC_APP_ENV || env.NODE_ENV || "development",
    checks,
    missing,
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
  for (const [name, present] of Object.entries(status.checks)) {
    logger.log(`- ${name}: ${present ? "yes" : "no"}`);
  }
  for (const [name, value] of Object.entries(status.adminSeed)) {
    logger.log(
      `- adminSeed.${name}: ${
        name === "adminResetPassword" ? value : value ? "yes" : "no"
      }`,
    );
  }
  logger.log(
    `- adminSeedConfigured: ${
      status.adminSeed.adminEmailPresent &&
      status.adminSeed.adminPasswordPresent
        ? "yes"
        : "no"
    }`,
  );
}

function validateStartupConfig({
  env = process.env,
  logger = console,
  failFast = env.NODE_ENV === "production",
} = {}) {
  const status = getRuntimeConfigStatus({ env });
  logStartupDiagnostics(status, logger);

  if (!status.valid) {
    const err = new Error(
      `Required runtime config is incomplete: ${status.missing.join(", ")}`,
    );
    if (failFast) throw err;
    logger.warn(err.message);
  }

  return status;
}

module.exports = {
  DEFAULT_PRIVATE_KEY_PATH,
  DEFAULT_PUBLIC_KEY_PATH,
  getConfiguredOrigins,
  getRuntimeConfigStatus,
  isPresent,
  isValidKmsMasterKey,
  logStartupDiagnostics,
  validateStartupConfig,
};
