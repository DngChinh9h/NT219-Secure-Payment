"use strict";

const {
  getRuntimeConfigStatus,
  validateStartupConfig,
} = require("../envValidation");

const TEST_PRIVATE_KEY_B64 = Buffer.from(
  "-----BE" + "GIN " + "PRIVATE KEY-----\ntest\n-----END " + "PRIVATE KEY-----",
).toString("base64");
const TEST_PUBLIC_KEY_B64 = Buffer.from(
  "-----BE" + "GIN " + "PUBLIC KEY-----\ntest\n-----END " + "PUBLIC KEY-----",
).toString("base64");

const validEnv = {
  NODE_ENV: "production",
  PUBLIC_APP_ENV: "production",
  DATABASE_URL: "postgres://private-database",
  JWT_PRIVATE_KEY_B64: TEST_PRIVATE_KEY_B64,
  JWT_PUBLIC_KEY_B64: TEST_PUBLIC_KEY_B64,
  STRIPE_SECRET_KEY: "sk_test_private",
  STRIPE_WEBHOOK_SECRET: "whsec_private",
  STRIPE_PUBLISHABLE_KEY: "pk_test_public",
  CORS_ORIGINS: "https://frontend.example",
  HMAC_SECRET: "private-hmac-secret",
  KMS_MASTER_KEY: "a".repeat(64),
};

describe("envValidation", () => {
  test("reports valid production runtime config without exposing secret values", () => {
    const status = getRuntimeConfigStatus({ env: validEnv });

    expect(status.valid).toBe(true);
    expect(status.environment).toBe("production");
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(validEnv.DATABASE_URL);
    expect(serialized).not.toContain(validEnv.STRIPE_SECRET_KEY);
    expect(serialized).not.toContain(validEnv.KMS_MASTER_KEY);
  });

  test("fails fast in production when required runtime config is missing", () => {
    const logger = { log: jest.fn(), warn: jest.fn() };

    expect(() =>
      validateStartupConfig({
        env: { NODE_ENV: "production" },
        logger,
      }),
    ).toThrow("Required runtime config is incomplete");
  });

  test("rejects production CORS wildcard configuration", () => {
    const status = getRuntimeConfigStatus({
      env: { ...validEnv, CORS_ORIGINS: "*" },
    });

    expect(status.valid).toBe(false);
    expect(status.missing).toContain(
      "CORS_ORIGINS without wildcard in production",
    );
  });

  test("startup diagnostics contain presence flags only", () => {
    const logger = { log: jest.fn(), warn: jest.fn() };

    validateStartupConfig({ env: validEnv, logger });

    const output = logger.log.mock.calls.flat().join("\n");
    expect(output).toContain("databaseUrlPresent: yes");
    expect(output).not.toContain(validEnv.DATABASE_URL);
    expect(output).not.toContain(validEnv.STRIPE_SECRET_KEY);
    expect(output).not.toContain(validEnv.KMS_MASTER_KEY);
  });
});
