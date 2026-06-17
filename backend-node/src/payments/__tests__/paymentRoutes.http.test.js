"use strict";

const express = require("express");

const mockAuthenticate = jest.fn((req, res) =>
  res.status(401).json({ error: "auth should not run" }),
);
jest.mock("../../gateway/authMiddleware", () => ({
  authenticate: mockAuthenticate,
}));

jest.mock("../../gateway/authzMiddleware", () => ({
  requireAdmin: jest.fn((req, res) =>
    res.status(403).json({ error: "admin auth should not run" }),
  ),
}));

jest.mock("../../gateway/rateLimiter", () => ({
  adminRefundLimiter: (req, res, next) => next(),
  paymentCreateIntentLimiter: (req, res, next) => next(),
}));

jest.mock("../../crypto", () => ({
  validate: () => (req, res, next) => next(),
  paymentSchema: {},
}));

jest.mock("../paymentController", () => ({
  createPaymentIntent: jest.fn((req, res) => res.status(200).json({ ok: true })),
  syncPayment: jest.fn((req, res) => res.status(200).json({ ok: true })),
  refundPayment: jest.fn((req, res) => res.status(200).json({ ok: true })),
}));

const mockHandleWebhook = jest.fn((req, res) =>
  res.status(200).json({
    received: true,
    rawBody: Buffer.isBuffer(req.body),
    bodyText: req.body.toString("utf8"),
  }),
);
jest.mock("../webhookHandler", () => ({
  handleWebhook: mockHandleWebhook,
}));

const paymentRoutes = require("../paymentRoutes");

function createApp() {
  const app = express();
  app.use((req, res, next) => {
    if (req.path === "/api/payments/webhook") return next();
    return express.json()(req, res, next);
  });
  app.use("/api/payments", paymentRoutes);
  app.use((req, res) => res.status(404).json({ error: "Route not found" }));
  return app;
}

async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("payment webhook HTTP route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST /api/payments/webhook reaches webhook handler without auth and keeps raw body", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": "sig_test",
        },
        body: JSON.stringify({ id: "evt_test" }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        received: true,
        rawBody: true,
        bodyText: '{"id":"evt_test"}',
      });
      expect(mockHandleWebhook).toHaveBeenCalledTimes(1);
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });
  });
});
