"use strict";

// Mock dotenv to prevent loading real .env
jest.mock("dotenv", () => ({ config: jest.fn() }));

// Mock DB — paymentService.js uses require('../db') which resolves to src/db
const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
  connect: jest.fn(),
}));

// Mock Stripe — paymentService.js does: const Stripe = require('stripe'); const stripe = Stripe(key);
const mockPaymentIntentsCreate = jest.fn();
jest.mock("stripe", () => {
  // Return a constructor function that returns the stripe instance
  return jest.fn().mockReturnValue({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
    },
  });
});

// Mock orderService
jest.mock("../../orders/orderService", () => ({
  getOrderById: jest.fn(),
  updateOrderStatus: jest.fn(),
}));

// Mock crypto
jest.mock("../../crypto", () => ({
  hmacSign: jest.fn(() => "mock-hmac-signature"),
  createSignedReceipt: jest.fn(() => "mock-jws-receipt"),
}));

const orderService = require("../../orders/orderService");
const { createPaymentIntent } = require("../paymentService");

describe("paymentService — double-spend prevention", () => {
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const userId = "660e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("atomic update rowCount = 0 → throw statusCode 409", async () => {
    // Simulate: no rows updated (order already processing or doesn't exist)
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: orderId, user_id: userId, status: "processing" }],
    });

    await expect(
      createPaymentIntent({
        orderId,
        stripeToken: "pm_test_123",
        amount: 50000,
        userId,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("already being processed"),
      statusCode: 409,
    });

    // Should have called UPDATE orders with atomic lock
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE orders"),
      expect.arrayContaining([orderId])
    );
  });

  test("atomic update rowCount = 1 but wrong user → throw 403 and rollback", async () => {
    // Simulate: order locked successfully but belongs to different user
    mockQuery.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: orderId, user_id: "different-user-id", status: "pending" }],
    });

    await expect(
      createPaymentIntent({
        orderId,
        stripeToken: "pm_test_123",
        amount: 50000,
        userId,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Forbidden"),
      statusCode: 403,
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain("user_id = $2");
    expect(mockQuery.mock.calls[1][0]).toContain("SELECT id, user_id, status");
  });

  test("atomic update rowCount = 1 → continues to Stripe call", async () => {
    // Simulate: order locked successfully
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: orderId, user_id: userId, total_amount: 50000 }],
    });

    // Stripe succeeds
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_test_intent",
      client_secret: "pi_test_secret",
      status: "requires_capture",
    });

    // UPDATE orders SET stripe_payment_intent_id
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await createPaymentIntent({
      orderId,
      stripeToken: "pm_test_123",
      amount: 50000,
      userId,
    });

    expect(result.paymentIntentId).toBe("pi_test_intent");
    expect(result.status).toBe("requires_capture");
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: 50000,
      currency: "vnd",
      payment_method: "pm_test_123",
      payment_method_types: ["card"],
      confirmation_method: "manual",
      confirm: true,
      metadata: {
        orderId,
        userId,
      },
    });
  });

  test("Stripe call fails → rollback order to pending", async () => {
    // Simulate: order locked successfully
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: orderId, user_id: userId, total_amount: 50000 }],
    });

    // Stripe fails
    mockPaymentIntentsCreate.mockRejectedValueOnce(
      new Error("Stripe API error")
    );

    // Rollback query — the .catch(() => {}) in the code means we need this
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      createPaymentIntent({
        orderId,
        stripeToken: "pm_test_123",
        amount: 50000,
        userId,
      })
    ).rejects.toThrow("Stripe API error");

    // Should have called rollback to pending
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const rollbackCall = mockQuery.mock.calls[1];
    expect(rollbackCall[0]).toContain("pending");
    expect(rollbackCall[0]).toContain("processing");
  });
});

describe("paymentService — provider abstraction", () => {
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const userId = "660e8400-e29b-41d4-a716-446655440000";
  const order = {
    id: orderId,
    user_id: userId,
    total_amount: 50000,
    created_at: "2026-05-30T00:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("mock_bank + mock_success pays order and creates secured transaction", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: "tx_mock_success",
            order_id: orderId,
            user_id: userId,
            amount: 50000,
            status: "success",
            hmac_signature: null,
            jws_receipt: null,
            created_at: "2026-05-30T00:00:01.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await createPaymentIntent({
      orderId,
      provider: "mock_bank",
      paymentToken: "mock_success",
      amount: 50000,
      userId,
    });

    expect(result).toMatchObject({
      clientSecret: null,
      provider: "mock_bank",
      status: "succeeded",
    });
    expect(result.paymentIntentId).toMatch(/^mock_pi_/);
    expect(orderService.updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "paid",
      expect.stringMatching(/^mock_pi_/),
    );
    expect(mockQuery.mock.calls[2][0]).toContain("INSERT INTO transactions");
    expect(mockQuery.mock.calls[2][0]).toContain("provider_payment_id");
  });

  test("mock_bank + mock_failed marks order payment_failed without success transaction", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] });

    const result = await createPaymentIntent({
      orderId,
      provider: "mock_bank",
      paymentToken: "mock_failed",
      amount: 50000,
      userId,
    });

    expect(result).toMatchObject({
      clientSecret: null,
      provider: "mock_bank",
      status: "failed",
    });
    expect(orderService.updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "payment_failed",
      expect.stringMatching(/^mock_pi_/),
    );
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test("mock_bank + mock_pending leaves order processing without transaction", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] });

    const result = await createPaymentIntent({
      orderId,
      provider: "mock_bank",
      paymentToken: "mock_pending",
      amount: 50000,
      userId,
    });

    expect(result).toMatchObject({
      clientSecret: null,
      provider: "mock_bank",
      status: "processing",
    });
    expect(orderService.updateOrderStatus).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test("stripe remains backward compatible with stripeToken", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [order],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_backward_compatible",
      client_secret: "pi_backward_secret",
      status: "requires_confirmation",
    });

    const result = await createPaymentIntent({
      orderId,
      stripeToken: "pm_card_visa",
      amount: 50000,
      userId,
    });

    expect(result).toMatchObject({
      clientSecret: "pi_backward_secret",
      paymentIntentId: "pi_backward_compatible",
      provider: "stripe",
      providerPaymentId: "pi_backward_compatible",
      status: "requires_confirmation",
    });
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: "pm_card_visa",
        payment_method_types: ["card"],
        confirmation_method: "manual",
        confirm: true,
      }),
    );
  });
});
