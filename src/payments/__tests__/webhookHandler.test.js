"use strict";

jest.mock("dotenv", () => ({ config: jest.fn() }));

const mockConstructEvent = jest.fn();
jest.mock("stripe", () =>
  jest.fn().mockReturnValue({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }),
);

const mockAuditLog = jest.fn();
jest.mock("../../transactions/auditService", () => ({
  log: mockAuditLog,
}));

const mockConfirmPayment = jest.fn();
jest.mock("../paymentService", () => ({
  confirmPayment: mockConfirmPayment,
}));

const mockRecordReceivedEvent = jest.fn();
const mockMarkProcessed = jest.fn();
const mockMarkFailed = jest.fn();
jest.mock("../webhookEventService", () => ({
  recordReceivedEvent: mockRecordReceivedEvent,
  markProcessed: mockMarkProcessed,
  markFailed: mockMarkFailed,
}));

jest.mock("../../db", () => ({
  query: jest.fn(),
}));

jest.mock("../../orders/orderService", () => ({
  updateOrderStatus: jest.fn(),
}));

const { handleWebhook } = require("../webhookHandler");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("webhookHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 200 for duplicate processed event without reprocessing", async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: "evt_processed",
      type: "payment_intent.succeeded",
      data: {
        object: {
          object: "payment_intent",
          id: "pi_processed",
        },
      },
    });
    mockRecordReceivedEvent.mockResolvedValueOnce({
      processing_status: "processed",
    });

    const req = {
      headers: { "stripe-signature": "sig_test" },
      body: Buffer.from("{}"),
    };
    const res = mockResponse();

    await handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    expect(mockMarkProcessed).not.toHaveBeenCalled();
  });

  test("marks event processed after successful payment_intent.succeeded handling", async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: "evt_new",
      type: "payment_intent.succeeded",
      data: {
        object: {
          object: "payment_intent",
          id: "pi_new",
          payment_method_details: { card: { last4: "4242" } },
        },
      },
    });
    mockRecordReceivedEvent.mockResolvedValueOnce({
      processing_status: "received",
    });
    mockConfirmPayment.mockResolvedValueOnce({ id: "tx_1" });

    const req = {
      headers: { "stripe-signature": "sig_test" },
      body: Buffer.from("{}"),
    };
    const res = mockResponse();

    await handleWebhook(req, res);

    expect(mockConfirmPayment).toHaveBeenCalledWith("pi_new", "4242");
    expect(mockMarkProcessed).toHaveBeenCalledWith({
      provider: "stripe",
      providerEventId: "evt_new",
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
