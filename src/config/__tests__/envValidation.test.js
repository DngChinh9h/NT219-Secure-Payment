"use strict";

const { getRuntimeConfigStatus, validateStartupConfig } = require("../envValidation");
const { createSecurityEnv } = require("../testSecurityEnvFixture");

describe("backend envValidation", () => {
  test("accepts the mandatory Security Service mTLS configuration without private keys", () => {
    const validEnv = createSecurityEnv();
    const status = getRuntimeConfigStatus({ env: validEnv });
    expect(status.valid).toBe(true);
    expect(status.checks.backendPrivateKeysAbsent).toBe(true);
    expect(JSON.stringify(status)).not.toContain(validEnv.DATABASE_URL);
    expect(JSON.stringify(status)).not.toContain(validEnv.STRIPE_SECRET_KEY);
  });

  test("rejects backend private-key and KMS settings", () => {
    const status = getRuntimeConfigStatus({ env: createSecurityEnv({ JWT_PRIVATE_KEY_PATH: "/run/keys/jwt-private.pem", KMS_MASTER_KEY: "a".repeat(64) }) });
    expect(status.valid).toBe(false);
    expect(status.missing.join(" ")).toMatch(/backend must not define/);
  });

  test("fails fast in production when Security Service mTLS settings are missing", () => {
    expect(() => validateStartupConfig({ env: { NODE_ENV: "production" }, logger: { log: jest.fn(), warn: jest.fn() } })).toThrow("Required runtime config is incomplete");
  });

  test("rejects HTTP Security Service URLs in production", () => {
    const status = getRuntimeConfigStatus({ env: createSecurityEnv({ SECURITY_SERVICE_BASE_URL: "http://security-service:9443" }) });
    expect(status.valid).toBe(false);
    expect(status.missing.join(" ")).toMatch(/using https/);
  });
});
