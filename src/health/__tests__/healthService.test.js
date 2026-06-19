"use strict";

const { checkReadiness } = require("../healthService");
const { createSecurityEnv } = require("../../config/testSecurityEnvFixture");

describe("healthService", () => {
  test("returns ready when database and mandatory Security Service configuration are available", async () => {
    const env = createSecurityEnv();
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }) };
    await expect(checkReadiness({ database, env })).resolves.toMatchObject({
      status: "ready", appAlive: true, database: { reachable: true }, config: { present: true, missing: [] }, stripe: { configured: true },
    });
  });

  test("returns not_ready when database is unreachable", async () => {
    const readiness = await checkReadiness({ database: { query: jest.fn().mockRejectedValueOnce(new Error("connection failed")) }, env: createSecurityEnv() });
    expect(readiness).toMatchObject({ status: "not_ready", database: { reachable: false } });
  });

  test("returns not_ready when a backend private key is configured", async () => {
    const readiness = await checkReadiness({ database: { query: jest.fn().mockResolvedValueOnce({}) }, env: createSecurityEnv({ JWT_PRIVATE_KEY: "forbidden" }) });
    expect(readiness.status).toBe("not_ready");
    expect(readiness.config.missing.join(" ")).toMatch(/backend must not define/);
  });
});
