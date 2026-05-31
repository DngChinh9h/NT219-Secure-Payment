"use strict";

const refundRequestService = require("./refundRequestService");
const auditService = require("../transactions/auditService");

async function createRefundRequest(req, res) {
  try {
    const request = await refundRequestService.createRefundRequest({
      ...req.body,
      userId: req.user.userId,
    });

    await auditService.log({
      eventType: "refund_request_created",
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: { requestId: request.id, orderId: request.order_id },
    });

    return res.status(201).json({ refundRequest: request });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
}

async function getMyRefundRequests(req, res) {
  try {
    const requests = await refundRequestService.getMyRefundRequests(
      req.user.userId,
    );
    return res.status(200).json({ refundRequests: requests });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get refund requests" });
  }
}

async function cancelRefundRequest(req, res) {
  try {
    const request = await refundRequestService.cancelRefundRequest({
      requestId: req.params.id,
      userId: req.user.userId,
    });

    await auditService.log({
      eventType: "refund_request_cancelled",
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: { requestId: request.id, orderId: request.order_id },
    });

    return res.status(200).json({ refundRequest: request });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
}

async function getAllRefundRequests(req, res) {
  try {
    const requests = await refundRequestService.getAllRefundRequests();
    return res.status(200).json({ refundRequests: requests });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get refund requests" });
  }
}

async function rejectRefundRequest(req, res) {
  try {
    const request = await refundRequestService.rejectRefundRequest({
      requestId: req.params.id,
      adminNote: req.body.adminNote,
      adminUserId: req.user.userId,
    });

    await auditService.log({
      eventType: "refund_request_rejected",
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: { requestId: request.id, orderId: request.order_id },
    });

    return res.status(200).json({ refundRequest: request });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
}

async function approveRefundRequest(req, res) {
  try {
    const result = await refundRequestService.approveRefundRequest({
      requestId: req.params.id,
      adminUserId: req.user.userId,
    });

    await auditService.log({
      eventType: "refund_request_succeeded",
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: {
        requestId: result.request.id,
        orderId: result.request.order_id,
        refundId: result.refund.refundId,
      },
    });

    return res.status(200).json({
      message: "Refund request approved and processed",
      refundRequest: result.request,
      refund: result.refund,
    });
  } catch (err) {
    return res.status(err.statusCode || 502).json({ error: err.message });
  }
}

module.exports = {
  approveRefundRequest,
  cancelRefundRequest,
  createRefundRequest,
  getAllRefundRequests,
  getMyRefundRequests,
  rejectRefundRequest,
};
