"use strict";

const http = require("http");
const cors = require("cors");
const express = require("express");
const {
  LOCAL_FRONTEND_ORIGIN,
  createCorsOptions,
  getAllowedOrigins,
} = require("../corsConfig");
const { getPublicConfig } = require("../configController");
const configRoutes = require("../configRoutes");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function request(app, { path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.get(
        { hostname: "127.0.0.1", port, path, headers },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            server.close(() => resolve({ res, body }));
          });
        },
      );

      req.on("error", (err) => {
        server.close(() => reject(err));
      });
    });
  });
}

describe("public config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("GET /api/config/public response returns public frontend config only", () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_public";
    process.env.STRIPE_SECRET_KEY = "sk_test_private";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_private";
    process.env.DATABASE_URL = "postgres://private";
    process.env.HMAC_SECRET = "hmac_private";

    const res = mockResponse();
    getPublicConfig({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      stripePublishableKey: "pk_test_public",
      environment: "sandbox",
      providers: {
        stripe: true,
        mock_bank: true,
      },
    });

    const response = JSON.stringify(res.json.mock.calls[0][0]);
    expect(response).not.toContain("sk_test_private");
    expect(response).not.toContain("whsec_private");
    expect(response).not.toContain("postgres://private");
    expect(response).not.toContain("hmac_private");
  });

  test("GET /api/config/public route returns 200 with local frontend CORS", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_public";

    const app = express();
    app.use(cors(createCorsOptions()));
    app.use("/api/config", configRoutes);

    const { res, body } = await request(app, {
      path: "/api/config/public",
      headers: { Origin: LOCAL_FRONTEND_ORIGIN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(LOCAL_FRONTEND_ORIGIN);
    expect(JSON.parse(body)).toHaveProperty(
      "stripePublishableKey",
      "pk_test_public",
    );
  });
});

describe("CORS config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CORS_ORIGINS;
    delete process.env.FRONTEND_ORIGIN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("allows local Vite frontend origin", (done) => {
    createCorsOptions().origin(LOCAL_FRONTEND_ORIGIN, (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
      done();
    });
  });

  test("supports comma-separated CORS_ORIGINS and FRONTEND_ORIGIN", () => {
    process.env.CORS_ORIGINS =
      "https://frontend-one.vercel.app, https://frontend-two.vercel.app";
    process.env.FRONTEND_ORIGIN = "https://legacy-frontend.example";

    expect(getAllowedOrigins()).toEqual([
      "http://localhost:5173",
      "https://frontend-one.vercel.app",
      "https://frontend-two.vercel.app",
      "https://legacy-frontend.example",
    ]);
  });
});
