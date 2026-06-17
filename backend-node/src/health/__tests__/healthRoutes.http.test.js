"use strict";

const express = require("express");

const mockCheckReadiness = jest.fn();
jest.mock("../healthService", () => ({
  checkReadiness: mockCheckReadiness,
}));

const { getLiveness } = require("../healthController");
const healthRoutes = require("../healthRoutes");

async function withServer(run) {
  const app = express();
  app.get("/health", getLiveness);
  app.use("/api/health", healthRoutes);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("health HTTP routes", () => {
  test("GET /health returns liveness", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.time).toBeDefined();
    });
  });

  test("GET /api/health/readiness returns safe readiness status", async () => {
    mockCheckReadiness.mockResolvedValueOnce({
      status: "ready",
      appAlive: true,
      database: { reachable: true },
      config: { present: true, missing: [] },
      stripe: { configured: true },
      environment: "production",
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health/readiness`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "ready",
        database: { reachable: true },
        stripe: { configured: true },
      });
      expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|sk_test_|whsec_/);
    });
  });

  test("readiness returns 503 when deployment is not ready", async () => {
    mockCheckReadiness.mockResolvedValueOnce({
      status: "not_ready",
      appAlive: true,
      database: { reachable: false },
      config: { present: true, missing: [] },
      stripe: { configured: true },
      environment: "production",
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health/readiness`);

      expect(response.status).toBe(503);
    });
  });
});
