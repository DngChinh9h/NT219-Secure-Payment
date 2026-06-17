"use strict";

const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
}));

const webhookEventService = require("../webhookEventService");

describe("webhookEventService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("recordReceivedEvent inserts a new received event", async () => {
    const event = {
      provider: "stripe",
      provider_event_id: "evt_1",
      processing_status: "received",
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [event] });

    const result = await webhookEventService.recordReceivedEvent({
      provider: "stripe",
      providerEventId: "evt_1",
      eventType: "payment_intent.succeeded",
      providerPaymentId: "pi_1",
      rawPayload: { id: "evt_1" },
    });

    expect(result).toBe(event);
    expect(mockQuery.mock.calls[0][0]).toContain("ON CONFLICT");
  });

  test("recordReceivedEvent returns existing event on duplicate", async () => {
    const existing = {
      provider: "stripe",
      provider_event_id: "evt_1",
      processing_status: "processed",
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [existing] });

    const result = await webhookEventService.recordReceivedEvent({
      provider: "stripe",
      providerEventId: "evt_1",
      eventType: "payment_intent.succeeded",
      providerPaymentId: "pi_1",
      rawPayload: { id: "evt_1" },
    });

    expect(result).toBe(existing);
    expect(mockQuery.mock.calls[1][0]).toContain("SELECT *");
  });

  test("markProcessed updates status and processed_at", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ processing_status: "processed" }],
    });

    const result = await webhookEventService.markProcessed({
      provider: "stripe",
      providerEventId: "evt_1",
    });

    expect(result.processing_status).toBe("processed");
    expect(mockQuery.mock.calls[0][0]).toContain("processed_at = NOW()");
  });

  test("markFailed stores error message", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ processing_status: "failed", error_message: "boom" }],
    });

    const result = await webhookEventService.markFailed({
      provider: "stripe",
      providerEventId: "evt_1",
      errorMessage: "boom",
    });

    expect(result.error_message).toBe("boom");
    expect(mockQuery.mock.calls[0][1]).toEqual(["stripe", "evt_1", "boom"]);
  });
});
