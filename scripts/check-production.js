"use strict";

const { spawnSync } = require("child_process");

const REQUIRED_ENV = [
  "API_BASE_URL",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
];

const checks = [
  ["refund flow", "scripts/e2e-refund-flow.js"],
  ["security evidence", "scripts/e2e-security-evidence.js"],
  ["key rotation", "scripts/e2e-key-rotation.js"],
  ["hardening", "scripts/e2e-hardening.js"],
  ["reconciliation", "scripts/e2e-reconciliation.js"],
];

function run() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(
      `Production E2E config missing: ${missing.join(", ")}`,
    );
    console.error(
      "Set API_BASE_URL, E2E_ADMIN_EMAIL, and E2E_ADMIN_PASSWORD before running this command.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Production E2E target: ${process.env.API_BASE_URL}`);
  console.log("This suite creates test orders, refunds, and a receipt signing key rotation.");

  for (const [name, script] of checks) {
    console.log(`\n=== Running ${name} ===`);
    const result = spawnSync(process.execPath, [script], {
      env: process.env,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      console.error(`Production E2E failed: ${name}`);
      process.exitCode = result.status || 1;
      return;
    }
  }

  console.log("\nProduction E2E checklist passed.");
}

run();
