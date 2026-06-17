"use strict";

const db = require("../db");
const { getRuntimeConfigStatus } = require("../config/envValidation");

function getDatabaseTimeoutMs(env = process.env) {
  const configured = Number(env.READINESS_DB_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 3000;
}

async function checkDatabase(database, env) {
  let timeout;

  try {
    await Promise.race([
      database.query("SELECT 1"),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Database readiness check timed out"));
        }, getDatabaseTimeoutMs(env));
        timeout.unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkReadiness({
  database = db,
  env = process.env,
} = {}) {
  const config = getRuntimeConfigStatus({ env });
  const databaseReachable = await checkDatabase(database, env);

  const stripeConfigured =
    config.checks.stripeSecretKeyPresent &&
    config.checks.stripeWebhookSecretPresent &&
    config.checks.stripePublishableKeyPresent;
  const ready = databaseReachable && config.valid && stripeConfigured;

  return {
    status: ready ? "ready" : "not_ready",
    appAlive: true,
    database: {
      reachable: databaseReachable,
    },
    config: {
      present: config.valid,
      missing: config.missing,
    },
    stripe: {
      configured: stripeConfigured,
    },
    environment: config.environment,
  };
}

module.exports = {
  checkDatabase,
  checkReadiness,
  getDatabaseTimeoutMs,
};
