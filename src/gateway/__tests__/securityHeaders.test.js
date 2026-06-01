"use strict";

const express = require("express");
const {
  getSecurityHeadersEvidence,
  securityHeaders,
  sensitiveNoStore,
} = require("../securityHeaders");

async function withServer(run) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(sensitiveNoStore);
  app.get("/api/auth/test", (req, res) => res.json({ ok: true }));
  app.get("/api/admin/test", (req, res) => res.json({ ok: true }));
  app.get("/health", (req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("security headers", () => {
  test("sets Helmet headers, disables x-powered-by, and prevents sensitive caching", async () => {
    await withServer(async (baseUrl) => {
      const auth = await fetch(`${baseUrl}/api/auth/test`);
      const admin = await fetch(`${baseUrl}/api/admin/test`);
      const health = await fetch(`${baseUrl}/health`);

      expect(auth.headers.get("x-powered-by")).toBeNull();
      expect(auth.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(auth.headers.get("cache-control")).toBe("no-store");
      expect(admin.headers.get("cache-control")).toBe("no-store");
      expect(health.headers.get("cache-control")).toBeNull();
    });
  });

  test("reports enabled middleware capabilities without secrets", () => {
    expect(getSecurityHeadersEvidence()).toMatchObject({
      enabled: true,
      helmet: true,
      xPoweredByDisabled: true,
      sensitiveNoStore: true,
    });
  });
});
