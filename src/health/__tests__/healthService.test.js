"use strict";

const { checkReadiness } = require("../healthService");

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
  KMS_MASTER_KEY: "b".repeat(64),
};

describe("healthService", () => {
  test("returns ready when database and required config are available", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }) };

    const readiness = await checkReadiness({ database, env: validEnv });

    expect(database.query).toHaveBeenCalledWith("SELECT 1");
    expect(readiness).toEqual({
      status: "ready",
      appAlive: true,
      database: { reachable: true },
      config: { present: true, missing: [] },
      stripe: { configured: true },
      environment: "production",
    });
    expect(JSON.stringify(readiness)).not.toContain(validEnv.DATABASE_URL);
    expect(JSON.stringify(readiness)).not.toContain(validEnv.STRIPE_SECRET_KEY);
  });

  test("returns not_ready when database is unreachable", async () => {
    const database = { query: jest.fn().mockRejectedValueOnce(new Error("connection failed")) };

    const readiness = await checkReadiness({ database, env: validEnv });

    expect(readiness).toMatchObject({
      status: "not_ready",
      appAlive: true,
      database: { reachable: false },
    });
  });

  test("returns not_ready when database readiness check times out", async () => {
    const database = { query: jest.fn(() => new Promise(() => {})) };

    const readiness = await checkReadiness({
      database,
      env: { ...validEnv, READINESS_DB_TIMEOUT_MS: "5" },
    });

    expect(readiness.status).toBe("not_ready");
    expect(readiness.database.reachable).toBe(false);
  });

  test("returns safe missing-config names instead of values", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({}) };

    const readiness = await checkReadiness({
      database,
      env: { NODE_ENV: "production" },
    });

    expect(readiness.status).toBe("not_ready");
    expect(readiness.config.present).toBe(false);
    expect(readiness.config.missing).toContain("DATABASE_URL");
    expect(JSON.stringify(readiness)).not.toMatch(/postgres:\/\/|sk_test_|whsec_/);
  });
});
