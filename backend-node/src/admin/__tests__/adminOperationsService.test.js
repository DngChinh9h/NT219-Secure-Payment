"use strict";

const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
}));

const service = require("../adminOperationsService");

describe("adminOperationsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns safe admin order fields", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "order_1",
        customer_email: "customer@example.com",
        total_amount: "50000",
        status: "paid",
        provider: "mock_bank",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:01:00.000Z",
        transaction_count: "1",
        refund_status: "pending_review",
      }],
    });

    await expect(service.getOrders()).resolves.toEqual([{
      id: "order_1",
      customerEmail: "customer@example.com",
      totalAmount: 50000,
      amount: 50000,
      status: "paid",
      provider: "mock_bank",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:01:00.000Z",
      transactionCount: 1,
      refundStatus: "pending_review",
    }]);
  });

  test("returns safe admin transaction fields", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "tx_1",
        order_id: "order_1",
        customer_email: "customer@example.com",
        provider: "stripe",
        provider_payment_id: "pi_1",
        amount: "50000",
        status: "success",
        refund_id: null,
        refunded_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      }],
    });

    await expect(service.getTransactions()).resolves.toEqual([{
      id: "tx_1",
      orderId: "order_1",
      customerEmail: "customer@example.com",
      provider: "stripe",
      provider_payment_id: "pi_1",
      amount: 50000,
      status: "success",
      refund_id: null,
      refunded_at: null,
      createdAt: "2026-06-01T00:00:00.000Z",
    }]);
  });

  test("returns safe provider event fields without raw payloads", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "event_1",
        provider: "stripe",
        event_type: "payment_intent.succeeded",
        provider_event_id: "evt_1",
        provider_payment_id: "pi_1",
        processing_status: "processed",
        received_at: "2026-06-01T00:00:00.000Z",
        processed_at: "2026-06-01T00:01:00.000Z",
        raw_payload: { secret: "must-not-leak" },
        error_message: "must-not-leak",
      }],
    });

    const result = await service.getProviderEvents();

    expect(result).toEqual({
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
    });
    expect(JSON.stringify(result)).not.toMatch(/raw_payload|must-not-leak/i);
  });

  test("returns an empty provider event response when persistence is unavailable", async () => {
    mockQuery.mockRejectedValueOnce({ code: "42P01" });

    await expect(service.getProviderEvents()).resolves.toEqual({
      items: [],
      message: "Provider event persistence is not enabled yet",
    });
  });
});
