"use strict";

const express = require("express");

const mockVerifyJWT = jest.fn();
jest.mock("../../crypto", () => ({
  verifyJWT: mockVerifyJWT,
}));

jest.mock("../adminOperationsService", () => ({
  getOrders: jest.fn(async () => [{
    id: "order_1",
    customerEmail: "customer@example.com",
    totalAmount: 50000,
    amount: 50000,
    status: "paid",
    provider: "mock_bank",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:01:00.000Z",
    transactionCount: 1,
    refundStatus: null,
  }]),
  getTransactions: jest.fn(async () => [{
    id: "tx_1",
    orderId: "order_1",
    customerEmail: "customer@example.com",
    provider: "mock_bank",
    provider_payment_id: "mock_pi_1",
    amount: 50000,
    status: "success",
    refund_id: null,
    refunded_at: null,
    createdAt: "2026-06-01T00:00:00.000Z",
  }]),
  getProviderEvents: jest.fn(async () => ({
    items: [{
      id: "event_1",
      provider: "stripe",
      eventType: "payment_intent.succeeded",
      providerEventId: "evt_1",
      relatedPaymentIntentId: "pi_1",
      status: "processed",
      receivedAt: "2026-06-01T00:00:00.000Z",
      processedAt: "2026-06-01T00:01:00.000Z",
    }],
  })),
}));

const adminOperationsRoutes = require("../adminOperationsRoutes");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminOperationsRoutes);
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

const PATHS = [
  "/api/admin/orders",
  "/api/admin/transactions",
  "/api/admin/provider-events",
];

describe("admin operations HTTP authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("routes return 401 without a token instead of 404", async () => {
    await withServer(async (baseUrl) => {
      for (const path of PATHS) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.status).toBe(401);
      }
    });
  });

  test("routes return 403 for a customer token", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "customer_1", role: "customer" });

    await withServer(async (baseUrl) => {
      for (const path of PATHS) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: "Bearer customer-token" },
        });
        expect(response.status).toBe(403);
      }
    });
  });

  test("admin can read safe operational data without leaked secrets", async () => {
    mockVerifyJWT.mockReturnValue({ userId: "admin_1", role: "admin" });

    await withServer(async (baseUrl) => {
      for (const path of PATHS) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: "Bearer admin-token" },
        });
        const body = await response.json();
        const serialized = JSON.stringify(body);

        expect(response.status).toBe(200);
        expect(serialized).not.toMatch(
          /STRIPE_SECRET_KEY|DATABASE_URL|PRIVATE_KEY|raw_payload|password_hash|wrapped_data_key|whsec_|sk_(?:test|live)_/i,
        );
      }
    });
  });
});
