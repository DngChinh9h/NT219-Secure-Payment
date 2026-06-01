"use strict";

require("dotenv").config();

function check(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

check("crypto index import", () => {
  require("../src/crypto");
});

check("receipt service import", () => {
  const { createSignedReceipt, verifyReceipt } = require("../src/crypto/receiptService");
  if (typeof createSignedReceipt !== "function") throw new Error("createSignedReceipt missing");
  if (typeof verifyReceipt !== "function") throw new Error("verifyReceipt missing");
});

check("PII service import", () => {
  const { encryptUserPII, decryptUserPII } = require("../src/users/piiService");
  if (typeof encryptUserPII !== "function") throw new Error("encryptUserPII missing");
  if (typeof decryptUserPII !== "function") throw new Error("decryptUserPII missing");
});

check("velocity check import", () => {
  const { checkVelocity, recordFailure } = require("../src/payments/velocityCheck");
  if (typeof checkVelocity !== "function") throw new Error("checkVelocity missing");
  if (typeof recordFailure !== "function") throw new Error("recordFailure missing");
});

check("security evidence service import", () => {
  const { getSecurityEvidence } = require("../src/security/securityEvidenceService");
  if (typeof getSecurityEvidence !== "function") {
    throw new Error("getSecurityEvidence missing");
  }
});

check("security hardening service import", () => {
  const { getSecurityHardeningEvidence } = require("../src/security/securityHardeningService");
  if (typeof getSecurityHardeningEvidence !== "function") {
    throw new Error("getSecurityHardeningEvidence missing");
  }
});

check("runtime config validator import", () => {
  const { getRuntimeConfigStatus } = require("../src/config/envValidation");
  if (typeof getRuntimeConfigStatus !== "function") {
    throw new Error("getRuntimeConfigStatus missing");
  }
});

check("health readiness service import", () => {
  const { checkReadiness } = require("../src/health/healthService");
  if (typeof checkReadiness !== "function") {
    throw new Error("checkReadiness missing");
  }
});
