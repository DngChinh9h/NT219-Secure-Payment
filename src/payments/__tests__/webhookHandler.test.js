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

function validSucceededEvent(overrides = {}) {
  return {
    id: "evt_new",
    type: "payment_intent.succeeded",
    data: {
      object: {
        object: "payment_intent",
        id: "pi_new",
        status: "succeeded",
        amount_received: 125000,
        currency: "vnd",
        metadata: {
          orderId: "order_1",
          userId: "user_1",
          payerUserId: "user_1",
          merchantId: "merchant_1",
        },
        payment_method_details: { card: { last4: "4242" } },
        ...overrides,
      },
    },
  };
}

describe("webhookHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects webhook requests without Stripe-Signature", async () => {
    const req = { headers: {}, body: Buffer.from("{}") };
    const res = mockResponse();

    await handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing Stripe-Signature header",
    });
    expect(mockConstructEvent).not.toHaveBeenCalled();
    expect(mockRecordReceivedEvent).not.toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "webhook_invalid",
        metadata: expect.objectContaining({ reason: "missing_signature" }),
      }),
    );
  });

  test("rejects invalid Stripe signature before ledger insert", async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error("bad signature");
    });
    const req = {
      headers: { "stripe-signature": "sig_bad" },
      body: Buffer.from("{}"),
    };
    const res = mockResponse();

    await handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRecordReceivedEvent).not.toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "webhook_invalid",
        metadata: expect.objectContaining({ reason: "invalid_signature" }),
      }),
    );
  });

  test("returns 200 for duplicate processed event without reprocessing", async () => {
    mockConstructEvent.mockReturnValueOnce(validSucceededEvent());
    mockRecordReceivedEvent.mockResolvedValueOnce({ processing_status: "processed" });
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

  test("marks event processed after valid payment_intent.succeeded reconciliation", async () => {
    mockConstructEvent.mockReturnValueOnce(validSucceededEvent());
    mockRecordReceivedEvent.mockResolvedValueOnce({ processing_status: "received" });
    mockConfirmPayment.mockResolvedValueOnce({
      id: "tx_1",
      merchant_id: "merchant_1",
      receipt_id: "receipt_1",
    });
    const req = {
      headers: { "stripe-signature": "sig_test" },
      body: Buffer.from("{}"),
    };
    const res = mockResponse();

    await handleWebhook(req, res);

    expect(mockConfirmPayment).toHaveBeenCalledWith("pi_new", "4242", {
      provider: "stripe",
      requireFullReconciliation: true,
      providerStatus: "succeeded",
      orderId: "order_1",
      payerUserId: "user_1",
      merchantId: "merchant_1",
      amount: 125000,
      currency: "vnd",
    });
    expect(mockMarkProcessed).toHaveBeenCalledWith({
      provider: "stripe",
      providerEventId: "evt_new",
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("amount/order/user mismatch does not mark event processed", async () => {
    mockConstructEvent.mockReturnValueOnce(validSucceededEvent({ amount_received: 1 }));
    mockRecordReceivedEvent.mockResolvedValueOnce({ processing_status: "received" });
    mockConfirmPayment.mockRejectedValueOnce(
      Object.assign(new Error("Payment reconciliation mismatch: amount"), {
        statusCode: 409,
      }),
    );
    const req = {
      headers: { "stripe-signature": "sig_test" },
      body: Buffer.from("{}"),
    };
    const res = mockResponse();

    await handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockMarkProcessed).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith({
      provider: "stripe",
      providerEventId: "evt_new",
      errorMessage: "Payment reconciliation mismatch: amount",
      mismatchReason: "Payment reconciliation mismatch: amount",
    });
  });
});
