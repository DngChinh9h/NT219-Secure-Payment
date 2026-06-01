"use strict";

const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
}));

const mockRefundTransaction = jest.fn();
jest.mock("../../payments/paymentService", () => ({
  refundTransaction: mockRefundTransaction,
}));

const service = require("../refundRequestService");

describe("refundRequestService customer workflow", () => {
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const transactionId = "660e8400-e29b-41d4-a716-446655440000";
  const userId = "770e8400-e29b-41d4-a716-446655440000";
  const requestId = "880e8400-e29b-41d4-a716-446655440000";
  const order = {
    id: orderId,
    user_id: userId,
    status: "paid",
    payment_provider: "mock_bank",
  };
  const transaction = {
    id: transactionId,
    order_id: orderId,
    user_id: userId,
    amount: 50000,
    status: "success",
    provider: "mock_bank",
    provider_payment_id: "mock_pi_1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("customer creates pending_review request for a paid order", async () => {
    const refundRequest = {
      id: requestId,
      order_id: orderId,
      transaction_id: transactionId,
      user_id: userId,
      status: "pending_review",
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [transaction] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [refundRequest] });

    const result = await service.createRefundRequest({
      orderId,
      userId,
      reason: "requested_by_customer",
      details: "Duplicate order",
    });

    expect(result).toEqual(refundRequest);
    expect(mockQuery.mock.calls[3][0]).toContain("pending_review");
    expect(mockRefundTransaction).not.toHaveBeenCalled();
  });

  test("rejects refund request for unpaid order", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...order, status: "pending" }],
    });

    await expect(
      service.createRefundRequest({
        orderId,
        userId,
        reason: "requested_by_customer",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Only paid orders"),
      statusCode: 409,
    });
  });

  test("rejects refund request for another user's order", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...order, user_id: "different-user-id" }],
    });

    await expect(
      service.createRefundRequest({
        orderId,
        userId,
        reason: "requested_by_customer",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Forbidden"),
      statusCode: 403,
    });
  });

  test("returns 409 for duplicate active request", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [transaction] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: requestId }] });

    await expect(
      service.createRefundRequest({
        orderId,
        userId,
        reason: "requested_by_customer",
      }),
    ).rejects.toMatchObject({
      message: "Active refund request already exists for order",
      statusCode: 409,
    });
  });

  test("returns 409 when transaction was already refunded", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [order] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...transaction, status: "refunded" }],
      });

    await expect(
      service.createRefundRequest({
        orderId,
        userId,
        reason: "requested_by_customer",
      }),
    ).rejects.toMatchObject({
      message: "Transaction already refunded",
      statusCode: 409,
    });
  });

  test("customer lists only own refund requests", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: requestId, user_id: userId }],
    });

    const result = await service.getMyRefundRequests(userId);

    expect(result).toEqual([{ id: requestId, user_id: userId }]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = $1"),
      [userId],
    );
  });

  test.each(["succeeded", "rejected", "approved_processing", "provider_failed"])(
    "customer cannot cancel %s request",
    async (status) => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: requestId, user_id: userId, status }],
      });

      await expect(
        service.cancelRefundRequest({ requestId, userId }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Only pending_review"),
        statusCode: 409,
      });
    },
  );
});

describe("refundRequestService admin workflow", () => {
  const requestId = "880e8400-e29b-41d4-a716-446655440000";
  const transactionId = "660e8400-e29b-41d4-a716-446655440000";
  const adminUserId = "990e8400-e29b-41d4-a716-446655440000";
  const pendingRequest = {
    id: requestId,
    order_id: "550e8400-e29b-41d4-a716-446655440000",
    transaction_id: transactionId,
    user_id: "770e8400-e29b-41d4-a716-446655440000",
    reason: "requested_by_customer",
    status: "pending_review",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("admin lists all requests with joined info", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [pendingRequest] });

    await expect(service.getAllRefundRequests()).resolves.toEqual([pendingRequest]);
    expect(mockQuery.mock.calls[0][0]).toContain("JOIN users");
    expect(mockQuery.mock.calls[0][0]).toContain("LEFT JOIN transactions");
  });

  test("admin rejects pending request with note", async () => {
    const rejected = { ...pendingRequest, status: "rejected", admin_note: "Denied" };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [rejected] });

    await expect(
      service.rejectRefundRequest({
        requestId,
        adminNote: "Denied",
        adminUserId,
      }),
    ).resolves.toEqual(rejected);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'rejected'"),
      [requestId, "Denied", adminUserId],
    );
  });

  test("admin approve calls existing refund logic and stores provider refund id", async () => {
    const processing = { ...pendingRequest, status: "approved_processing" };
    const succeeded = {
      ...processing,
      status: "succeeded",
      provider_refund_id: "mock_re_1",
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [processing] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [succeeded] });
    mockRefundTransaction.mockResolvedValueOnce({
      message: "Refund processed",
      refundId: "mock_re_1",
      providerStatus: "succeeded",
      transaction: { id: transactionId, status: "refunded" },
    });

    const result = await service.approveRefundRequest({ requestId, adminUserId });

    expect(mockRefundTransaction).toHaveBeenCalledWith({
      transactionId,
      reason: "requested_by_customer",
      userId: adminUserId,
      role: "admin",
      metadata: {
        refundRequestId: requestId,
      },
      mockRefundOutcome: undefined,
    });
    expect(result.request).toEqual(succeeded);
  });

  test("admin approve keeps request processing while provider refund is pending", async () => {
    const processing = { ...pendingRequest, status: "approved_processing" };
    const stillProcessing = {
      ...processing,
      provider_refund_id: "mock_re_pending",
      provider_error: null,
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [processing] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [stillProcessing] });
    mockRefundTransaction.mockResolvedValueOnce({
      message: "Refund pending provider confirmation",
      refundId: "mock_re_pending",
      providerStatus: "pending",
      transaction: { id: transactionId, status: "success" },
    });

    const result = await service.approveRefundRequest({
      requestId,
      adminUserId,
      mockRefundOutcome: "pending",
    });

    expect(result.request).toEqual(stillProcessing);
    expect(mockQuery.mock.calls[1][1]).toEqual([
      requestId,
      "approved_processing",
      "mock_re_pending",
      null,
    ]);
  });

  test("admin approve stores provider_failed without marking refund succeeded", async () => {
    const processing = { ...pendingRequest, status: "approved_processing" };
    const providerFailed = {
      ...processing,
      status: "provider_failed",
      provider_refund_id: "mock_re_failed",
      provider_error: "MockBank refund failed",
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [processing] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [providerFailed] });
    mockRefundTransaction.mockResolvedValueOnce({
      message: "Refund provider failed",
      refundId: "mock_re_failed",
      providerStatus: "failed",
      providerError: "MockBank refund failed",
      transaction: { id: transactionId, status: "success" },
    });

    const result = await service.approveRefundRequest({
      requestId,
      adminUserId,
      mockRefundOutcome: "failed",
    });

    expect(result.request).toEqual(providerFailed);
    expect(mockQuery.mock.calls[1][1]).toEqual([
      requestId,
      "provider_failed",
      "mock_re_failed",
      "MockBank refund failed",
    ]);
  });

  test("duplicate refund is blocked and request records provider_failed", async () => {
    const processing = { ...pendingRequest, status: "approved_processing" };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [processing] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const err = Object.assign(new Error("Transaction already refunded"), {
      statusCode: 409,
    });
    mockRefundTransaction.mockRejectedValueOnce(err);

    await expect(
      service.approveRefundRequest({ requestId, adminUserId }),
    ).rejects.toBe(err);

    expect(mockQuery.mock.calls[1][0]).toContain("provider_failed");
    expect(mockQuery.mock.calls[1][1]).toEqual([
      requestId,
      "Transaction already refunded",
    ]);
  });
});
