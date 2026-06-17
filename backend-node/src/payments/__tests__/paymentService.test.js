"use strict";

// Mock dotenv to prevent loading real .env
jest.mock("dotenv", () => ({ config: jest.fn() }));

// Mock DB — paymentService.js uses require('../db') which resolves to src/db
const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
  connect: mockConnect,
}));

// Mock Stripe — paymentService.js does: const Stripe = require('stripe'); const stripe = Stripe(key);
const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();
jest.mock("stripe", () => {
  // Return a constructor function that returns the stripe instance
  return jest.fn().mockReturnValue({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
    },
    refunds: {
      create: mockRefundsCreate,
    },
  });
});

describe("paymentService sync and idempotency", () => {
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const userId = "660e8400-e29b-41d4-a716-446655440000";
  const paymentIntentId = "pi_sync_succeeded";
  const order = {
    id: orderId,
    user_id: userId,
    total_amount: 50000,
    status: "processing",
    payment_provider: "stripe",
    stripe_payment_intent_id: paymentIntentId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("syncPayment confirms succeeded provider status and returns transaction", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: "tx_sync",
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

    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: paymentIntentId,
      status: "succeeded",
      client_secret: "pi_sync_secret",
    });

    const result = await syncPayment({
      paymentIntentId,
      userId,
      role: "customer",
    });

    expect(result).toMatchObject({
      paymentIntentId,
      provider: "stripe",
      providerStatus: "succeeded",
      orderStatus: "paid",
    });
    expect(result.transaction.id).toBe("tx_sync");
    expect(orderService.updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "paid",
      paymentIntentId,
    );
  });

  test("syncPayment returns provider status without confirming unfinished payment", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [order] });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: paymentIntentId,
      status: "processing",
      client_secret: "pi_sync_secret",
    });

    const result = await syncPayment({
      paymentIntentId,
      userId,
      role: "customer",
    });

    expect(result).toMatchObject({
      paymentIntentId,
      providerStatus: "processing",
      orderStatus: "processing",
      transaction: null,
    });
    expect(orderService.updateOrderStatus).not.toHaveBeenCalled();
  });

  test("syncPayment blocks non-owner non-admin users", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...order, user_id: "different-user-id" }],
    });

    await expect(
      syncPayment({
        paymentIntentId,
        userId,
        role: "customer",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Forbidden"),
      statusCode: 403,
    });
    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  test("confirmPayment returns existing transaction without duplicate insert", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: "tx_existing",
            order_id: orderId,
            user_id: userId,
            status: "success",
            stripe_token_last4: "4242",
            hmac_signature: "existing-hmac",
            jws_receipt: "existing-jws",
          },
        ],
      });

    const tx = await confirmPayment(paymentIntentId, "4242");

    expect(tx.id).toBe("tx_existing");
    expect(
      mockQuery.mock.calls.some((call) =>
        call[0].includes("INSERT INTO transactions"),
      ),
    ).toBe(false);
  });

  test("new transaction insert uses ON CONFLICT for DB idempotency", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: "tx_new",
            order_id: orderId,
            user_id: userId,
            amount: 50000,
            status: "success",
            hmac_signature: "existing-hmac",
            jws_receipt: "existing-jws",
            created_at: "2026-05-30T00:00:01.000Z",
          },
        ],
      });

    await confirmPayment(paymentIntentId, "4242");

    const insertCall = mockQuery.mock.calls.find((call) =>
      call[0].includes("INSERT INTO transactions"),
    );
    expect(insertCall[0]).toContain("ON CONFLICT (stripe_payment_id)");
  });
});

describe("paymentService refund flow", () => {
  const transactionId = "770e8400-e29b-41d4-a716-446655440000";
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const userId = "660e8400-e29b-41d4-a716-446655440000";
  const successTx = {
    id: transactionId,
    order_id: orderId,
    user_id: userId,
    amount: 50000,
    status: "success",
    provider: "mock_bank",
    provider_payment_id: "mock_pi_success",
    stripe_payment_id: "mock_pi_success",
    order_status: "paid",
  };
  const mockClientQuery = jest.fn();
  const mockClientRelease = jest.fn();

  function mockSuccessfulRefundPersistence(updatedTx) {
    mockConnect.mockResolvedValueOnce({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockClientQuery
      .mockResolvedValueOnce()
      .mockResolvedValueOnce({ rowCount: 1, rows: [updatedTx] })
      .mockResolvedValueOnce();
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.REFUND_PROVIDER_TIMEOUT_MS;
    jest.useRealTimers();
  });

  test("refunds a successful mock_bank transaction", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [successTx] });
    mockSuccessfulRefundPersistence({
      ...successTx,
      status: "refunded",
      refund_id: "mock_re_1",
    });

    const result = await refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      userId,
      role: "customer",
    });

    expect(result.message).toBe("Refund processed");
    expect(result.refundId).toMatch(/^mock_re_/);
    expect(result.providerStatus).toBe("succeeded");
    expect(result.transaction.status).toBe("refunded");
    expect(orderService.updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "refunded",
      "mock_pi_success",
      expect.objectContaining({ query: mockClientQuery }),
    );
  });

  test("rejects second refund with 409", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...successTx, status: "refunded" }],
    });

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        userId,
        role: "customer",
      }),
    ).rejects.toMatchObject({
      message: "Transaction already refunded",
      statusCode: 409,
    });
  });

  test("rejects refund from another user with 403", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...successTx, user_id: "different-user-id" }],
    });

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        userId,
        role: "customer",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Forbidden"),
      statusCode: 403,
    });
  });

  test("rejects missing transaction with 404", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        userId,
        role: "customer",
      }),
    ).rejects.toMatchObject({
      message: "Transaction not found",
      statusCode: 404,
    });
  });

  test("rejects non-success transaction with 409", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...successTx, status: "failed" }],
    });

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        userId,
        role: "customer",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Only successful transactions"),
      statusCode: 409,
    });
  });

  test("refunds a successful stripe transaction through Stripe refund API", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          ...successTx,
          provider: "stripe",
          provider_payment_id: "pi_refund",
          stripe_payment_id: "pi_refund",
        },
      ],
    });
    mockSuccessfulRefundPersistence({
      ...successTx,
      status: "refunded",
      refund_id: "re_1",
    });
    mockRefundsCreate.mockResolvedValueOnce({
      id: "re_1",
      status: "succeeded",
    });

    const result = await refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      userId,
      role: "customer",
    });

    expect(result.refundId).toBe("re_1");
    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: "pi_refund",
      amount: 50000,
      reason: "requested_by_customer",
      metadata: {
        orderId,
        transactionId,
        userId,
      },
    });
  });

  test("does not update transaction or order while provider refund is pending", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [successTx] });

    const result = await refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      userId,
      role: "admin",
      mockRefundOutcome: "pending",
    });

    expect(result).toMatchObject({
      message: "Refund pending provider confirmation",
      provider: "mock_bank",
      providerStatus: "pending",
      transaction: successTx,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(orderService.updateOrderStatus).not.toHaveBeenCalled();
  });

  test("does not update transaction or order when provider refund fails", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [successTx] });

    const result = await refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      userId,
      role: "admin",
      mockRefundOutcome: "failed",
    });

    expect(result).toMatchObject({
      message: "Refund provider failed",
      provider: "mock_bank",
      providerStatus: "failed",
      providerError: "MockBank refund failed",
      transaction: successTx,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(orderService.updateOrderStatus).not.toHaveBeenCalled();
  });

  test("rolls back refunded transaction update if order update fails", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [successTx] });
    mockConnect.mockResolvedValueOnce({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockClientQuery
      .mockResolvedValueOnce()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...successTx, status: "refunded" }],
      })
      .mockResolvedValueOnce();
    orderService.updateOrderStatus.mockRejectedValueOnce(
      new Error("Order update failed"),
    );

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        userId,
        role: "admin",
      }),
    ).rejects.toThrow("Order update failed");

    expect(mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mockClientQuery).toHaveBeenNthCalledWith(3, "ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test("times out a refund provider that does not respond", async () => {
    jest.useFakeTimers();
    process.env.REFUND_PROVIDER_TIMEOUT_MS = "5";
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          ...successTx,
          provider: "stripe",
          provider_payment_id: "pi_timeout",
          stripe_payment_id: "pi_timeout",
        },
      ],
    });
    mockRefundsCreate.mockReturnValueOnce(new Promise(() => {}));

    const refundPromise = refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      userId,
      role: "admin",
    });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(5);

    await expect(refundPromise).rejects.toMatchObject({
      message: "Refund provider timed out after 5ms",
      statusCode: 504,
    });

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
const {
  createPaymentIntent,
  confirmPayment,
  refundTransaction,
  syncPayment,
} = require("../paymentService");

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
