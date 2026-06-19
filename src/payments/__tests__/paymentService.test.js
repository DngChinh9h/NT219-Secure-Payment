"use strict";

jest.mock("dotenv", () => ({ config: jest.fn() }));

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
  connect: mockConnect,
}));

const mockPaymentIntentsCreate = jest.fn();
const mockRefundsCreate = jest.fn();
jest.mock("stripe", () =>
  jest.fn().mockReturnValue({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: jest.fn(),
    },
    refunds: {
      create: mockRefundsCreate,
    },
  }),
);

jest.mock("../../orders/orderService", () => ({
  updateOrderStatus: jest.fn(),
}));

jest.mock("../../crypto", () => ({
  computeMac: jest.fn(() => "mac"),
  createSignedReceipt: jest.fn(() => "jws"),
}));

const orderService = require("../../orders/orderService");
const {
  assertReconciliation,
  createPaymentIntent,
  refundTransaction,
} = require("../paymentService");

const orderId = "550e8400-e29b-41d4-a716-446655440000";
const payerUserId = "660e8400-e29b-41d4-a716-446655440000";
const merchantId = "770e8400-e29b-41d4-a716-446655440000";
const transactionId = "880e8400-e29b-41d4-a716-446655440000";

function makeClient() {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  mockConnect.mockResolvedValueOnce(client);
  return client;
}

function makeOrder(overrides = {}) {
  return {
    id: orderId,
    user_id: payerUserId,
    merchant_id: merchantId,
    merchant_user_id: "merchant-user",
    total_amount: 125000,
    currency: "vnd",
    status: "pending",
    order_items_hash: "items-hash",
    ...overrides,
  };
}

describe("paymentService createPaymentIntent", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockPaymentIntentsCreate.mockReset();
    mockRefundsCreate.mockReset();
    orderService.updateOrderStatus.mockReset();
  });

  test("uses order amount from DB and sends payer/merchant metadata to Stripe", async () => {
    const client = makeClient();
    const order = makeOrder();
    const attempt = {
      id: "attempt_1",
      order_id: orderId,
      payer_user_id: payerUserId,
      merchant_id: merchantId,
      provider: "stripe",
      amount: 125000,
      currency: "vnd",
      idempotency_key: "pay-key-1",
      status: "created",
    };

    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [attempt] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...order, status: "processing" }] })
      .mockResolvedValueOnce({}); // COMMIT

    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_1",
      client_secret: "secret",
      status: "requires_confirmation",
      amount: 125000,
      currency: "vnd",
      metadata: {
        orderId,
        userId: payerUserId,
        payerUserId,
        merchantId,
      },
    });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ ...attempt, provider_payment_id: "pi_1", status: "requires_confirmation" }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await createPaymentIntent({
      orderId,
      userId: payerUserId,
      stripeToken: "pm_card_visa",
      amount: 1,
      idempotencyKey: "pay-key-1",
    }).catch((err) => {
      expect(err.message).toBe("Payment amount does not match order total");
      return null;
    });

    expect(result).toBeNull();
  });

  test("creates Stripe payment with DB amount when optional amount matches", async () => {
    const client = makeClient();
    const order = makeOrder();
    const attempt = {
      id: "attempt_1",
      order_id: orderId,
      payer_user_id: payerUserId,
      merchant_id: merchantId,
      provider: "stripe",
      amount: 125000,
      currency: "vnd",
      idempotency_key: "pay-key-1",
      status: "created",
    };

    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [attempt] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...order, status: "processing" }] })
      .mockResolvedValueOnce({});
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_1",
      client_secret: "secret",
      status: "requires_confirmation",
      amount: 125000,
      currency: "vnd",
      metadata: {},
    });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ ...attempt, provider_payment_id: "pi_1", status: "requires_confirmation" }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await createPaymentIntent({
      orderId,
      userId: payerUserId,
      stripeToken: "pm_card_visa",
      amount: 125000,
      idempotencyKey: "pay-key-1",
    });

    expect(result).toMatchObject({
      paymentIntentId: "pi_1",
      amount: 125000,
      currency: "vnd",
    });
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 125000,
        currency: "vnd",
        metadata: {
          orderId,
          userId: payerUserId,
          payerUserId,
          merchantId,
        },
      }),
      { idempotencyKey: "pay-key-1" },
    );
  });

  test("rejects customer paying another user's order", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [makeOrder({ user_id: "different-user" })],
      });

    await expect(
      createPaymentIntent({
        orderId,
        userId: payerUserId,
        stripeToken: "pm_card_visa",
        amount: 125000,
        idempotencyKey: "pay-key-2",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  test("returns existing provider payment for idempotent retry with fresh nonce", async () => {
    const client = makeClient();
    const order = makeOrder({ status: "processing" });
    const existingAttempt = {
      id: "attempt_existing",
      order_id: orderId,
      payer_user_id: payerUserId,
      merchant_id: merchantId,
      provider: "stripe",
      provider_payment_id: "pi_existing",
      amount: 125000,
      currency: "vnd",
      idempotency_key: "same-pay-key",
      status: "requires_confirmation",
    };

    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [existingAttempt] })
      .mockResolvedValueOnce({});

    const result = await createPaymentIntent({
      orderId,
      userId: payerUserId,
      stripeToken: "pm_card_visa",
      amount: 125000,
      idempotencyKey: "same-pay-key",
    });

    expect(result).toMatchObject({
      idempotent: true,
      paymentIntentId: "pi_existing",
      paymentAttemptId: "attempt_existing",
    });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });
});

describe("paymentService reconciliation guard", () => {
  const attempt = {
    order_id: orderId,
    payer_user_id: payerUserId,
    merchant_id: merchantId,
    amount: 125000,
    currency: "vnd",
  };

  test("accepts exact provider confirmation", () => {
    expect(() =>
      assertReconciliation({
        attempt,
        providerPaymentId: "pi_1",
        details: {
          requireFullReconciliation: true,
          providerStatus: "succeeded",
          orderId,
          payerUserId,
          merchantId,
          amount: 125000,
          currency: "vnd",
        },
      }),
    ).not.toThrow();
  });

  test.each([
    ["amount", { amount: 1 }],
    ["currency", { currency: "usd" }],
    ["orderId", { orderId: "other-order" }],
    ["payerUserId", { payerUserId: "other-user" }],
    ["merchantId", { merchantId: "other-merchant" }],
    ["providerStatus", { providerStatus: "processing" }],
  ])("rejects %s mismatch", (field, override) => {
    expect(() =>
      assertReconciliation({
        attempt,
        providerPaymentId: "pi_1",
        details: {
          requireFullReconciliation: true,
          providerStatus: "succeeded",
          orderId,
          payerUserId,
          merchantId,
          amount: 125000,
          currency: "vnd",
          ...override,
        },
      }),
    ).toThrow("Payment reconciliation mismatch");
  });
});

describe("paymentService refundTransaction", () => {
  const successTx = {
    id: transactionId,
    order_id: orderId,
    user_id: payerUserId,
    payer_user_id: payerUserId,
    merchant_id: merchantId,
    amount: 125000,
    currency: "vnd",
    status: "success",
    provider: "mock_bank",
    provider_payment_id: "mock_pi_1",
    stripe_payment_id: "mock_pi_1",
    order_status: "paid",
  };

  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockPaymentIntentsCreate.mockReset();
    mockRefundsCreate.mockReset();
    orderService.updateOrderStatus.mockReset();
  });

  test.each(["customer", "merchant"])("rejects %s refund attempts", async (role) => {
    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        idempotencyKey: "refund-key",
        userId: "actor",
        role,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("rejects refund amount over paid amount", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [successTx] });

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        amount: 125001,
        idempotencyKey: "refund-key",
        userId: "admin",
        role: "admin",
      }),
    ).rejects.toMatchObject({
      message: "Refund amount exceeds paid amount",
      statusCode: 400,
    });
  });

  test("blocks double refund with a different idempotency key", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [successTx] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "refund_existing" }] });

    await expect(
      refundTransaction({
        transactionId,
        reason: "requested_by_customer",
        idempotencyKey: "refund-key-2",
        userId: "admin",
        role: "admin",
      }),
    ).rejects.toMatchObject({
      message: "Transaction already has a refund",
      statusCode: 409,
    });
  });

  test("returns the same refund for an idempotent retry", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "refund_1",
        transaction_id: transactionId,
        provider: "mock_bank",
        provider_status: "succeeded",
        status: "succeeded",
        provider_refund_id: "mock_re_1",
      }],
    });

    const result = await refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      idempotencyKey: "refund-key",
      userId: "admin",
      role: "admin",
    });

    expect(result).toMatchObject({
      message: "Refund idempotent result",
      refundId: "mock_re_1",
      providerStatus: "succeeded",
    });
  });

  test("admin refunds a successful transaction and records refund ledger", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [successTx] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: "refund_1",
          transaction_id: transactionId,
          provider: "mock_bank",
          provider_payment_id: "mock_pi_1",
          status: "processing",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "refund_1",
          transaction_id: transactionId,
          provider: "mock_bank",
          provider_status: "succeeded",
          provider_refund_id: "mock_re_1",
          status: "succeeded",
        }],
      });
    const client = makeClient();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...successTx, status: "refunded", refund_id: "mock_re_1" }],
      })
      .mockResolvedValueOnce({});

    const result = await refundTransaction({
      transactionId,
      reason: "requested_by_customer",
      idempotencyKey: "refund-key",
      userId: "admin",
      role: "admin",
    });

    expect(result).toMatchObject({
      message: "Refund processed",
      refundId: "mock_re_1",
      providerStatus: "succeeded",
    });
    expect(orderService.updateOrderStatus).toHaveBeenCalledWith(
      orderId,
      "refunded",
      "mock_pi_1",
      expect.objectContaining({ query: client.query }),
    );
  });
});
