"use strict";

const mockCreateRefundRequest = jest.fn();
const mockApproveRefundRequest = jest.fn();
jest.mock("../refundRequestService", () => ({
  createRefundRequest: mockCreateRefundRequest,
  approveRefundRequest: mockApproveRefundRequest,
}));

const mockAuditLog = jest.fn();
jest.mock("../../transactions/auditService", () => ({
  log: mockAuditLog,
}));

const controller = require("../refundRequestController");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("refundRequestController blocked-attempt evidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(null);
  });

  test("records duplicate customer refund request evidence", async () => {
    mockCreateRefundRequest.mockRejectedValueOnce(
      Object.assign(new Error("Active refund request already exists for order"), {
        statusCode: 409,
      }),
    );
    const req = {
      body: { orderId: "order_1", reason: "requested_by_customer" },
      user: { userId: "user_1" },
      ip: "127.0.0.1",
    };
    const res = mockResponse();

    await controller.createRefundRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "refund_request_blocked",
        actorUserId: "user_1",
        targetId: "order_1",
      }),
    );
  });

  test("records duplicate admin approve evidence", async () => {
    mockApproveRefundRequest.mockRejectedValueOnce(
      Object.assign(new Error("Only pending_review requests can be approved"), {
        statusCode: 409,
      }),
    );
    const req = {
      body: {},
      params: { id: "refund_1" },
      user: { userId: "admin_1" },
      ip: "127.0.0.1",
    };
    const res = mockResponse();

    await controller.approveRefundRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "refund_approval_blocked",
        actorUserId: "admin_1",
        targetId: "refund_1",
      }),
    );
  });
});
