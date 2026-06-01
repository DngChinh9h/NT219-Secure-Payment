"use strict";

jest.mock("dotenv", () => ({ config: jest.fn() }));

const mockRefundsCreate = jest.fn();
jest.mock("stripe", () =>
  jest.fn().mockReturnValue({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    refunds: {
      create: mockRefundsCreate,
    },
  }),
);

const stripeProvider = require("../providers/stripeProvider");

describe("stripeProvider refundPayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("creates a Stripe refund and maps succeeded status", async () => {
    mockRefundsCreate.mockResolvedValueOnce({
      id: "re_succeeded",
      status: "succeeded",
    });

    const result = await stripeProvider.refundPayment({
      providerPaymentId: "pi_refund",
      amount: 50000,
      reason: "customer_request",
      metadata: {
        orderId: "order-1",
        transactionId: "tx-1",
        refundRequestId: "request-1",
        userId: "user-1",
      },
    });

    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: "pi_refund",
      amount: 50000,
      reason: "requested_by_customer",
      metadata: {
        orderId: "order-1",
        transactionId: "tx-1",
        refundRequestId: "request-1",
        userId: "user-1",
      },
    });
    expect(result).toMatchObject({
      provider: "stripe",
      refundId: "re_succeeded",
      status: "succeeded",
      providerError: null,
    });
  });

  test("maps pending Stripe refunds to pending", async () => {
    mockRefundsCreate.mockResolvedValueOnce({
      id: "re_pending",
      status: "pending",
    });

    await expect(
      stripeProvider.refundPayment({
        providerPaymentId: "pi_refund",
        amount: 50000,
        reason: "duplicate",
      }),
    ).resolves.toMatchObject({
      refundId: "re_pending",
      status: "pending",
      providerError: null,
    });
  });

  test("maps failed Stripe refunds and keeps the provider failure reason", async () => {
    mockRefundsCreate.mockResolvedValueOnce({
      id: "re_failed",
      status: "failed",
      failure_reason: "lost_or_stolen_card",
    });

    await expect(
      stripeProvider.refundPayment({
        providerPaymentId: "pi_refund",
        amount: 50000,
        reason: "fraudulent",
      }),
    ).resolves.toMatchObject({
      refundId: "re_failed",
      status: "failed",
      providerError: "lost_or_stolen_card",
    });
  });

  test("maps canceled Stripe refunds to failed", async () => {
    mockRefundsCreate.mockResolvedValueOnce({
      id: "re_canceled",
      status: "canceled",
    });

    await expect(
      stripeProvider.refundPayment({
        providerPaymentId: "pi_refund",
        amount: 50000,
        reason: "other",
      }),
    ).resolves.toMatchObject({
      refundId: "re_canceled",
      status: "failed",
    });
  });
});
