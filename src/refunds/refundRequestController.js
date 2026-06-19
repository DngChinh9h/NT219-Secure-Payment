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
      eventType: "refund_requested",
      actorUserId: req.user.userId,
      targetType: "refund_request",
      targetId: request.id,
      ipAddress: req.ip,
      metadata: { orderId: request.order_id },
    });

    return res.status(201).json({ refundRequest: request });
  } catch (err) {
    if (err.statusCode === 409) {
      await auditService.log({
        eventType: "refund_request_blocked",
        actorUserId: req.user.userId,
        targetType: "order",
        targetId: req.body?.orderId || null,
        ipAddress: req.ip,
        metadata: {
          orderId: req.body?.orderId || null,
          reason: err.message,
        },
      });
    }
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

async function getMerchantRefundRequests(req, res) {
  try {
    if (!["merchant", "admin"].includes(req.user.role)) {
      await auditService.log({
        eventType: "rbac_violation",
        actorUserId: req.user.userId,
        targetType: "refund_requests",
        metadata: { route: "merchant_refunds", role: req.user.role },
        ipAddress: req.ip,
      });
      return res.status(403).json({ error: "Requires role: merchant or admin" });
    }

    const requests = await refundRequestService.getMerchantRefundRequests({
      userId: req.user.userId,
      role: req.user.role,
    });
    return res.status(200).json({ refundRequests: requests });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get merchant refund requests" });
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
      eventType: "admin_rejected_refund",
      actorUserId: req.user.userId,
      targetType: "refund_request",
      targetId: request.id,
      ipAddress: req.ip,
      metadata: { orderId: request.order_id },
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
      mockRefundOutcome: req.body.mockRefundOutcome,
    });

    await auditService.log({
      eventType: "refund_approved",
      actorUserId: req.user.userId,
      targetType: "refund_request",
      targetId: result.request.id,
      ipAddress: req.ip,
      metadata: {
        orderId: result.request.order_id,
        refundId: result.refund.refundId,
        providerStatus: result.refund.providerStatus,
      },
    });
    if (result.refund.providerStatus !== "pending") {
      await auditService.log({
        eventType:
          result.refund.providerStatus === "succeeded"
            ? "provider_refund_succeeded"
            : "provider_refund_failed",
        actorUserId: req.user.userId,
        targetType: "refund_request",
        targetId: result.request.id,
        ipAddress: req.ip,
        metadata: {
          orderId: result.request.order_id,
          refundId: result.refund.refundId,
          providerStatus: result.refund.providerStatus,
          providerError: result.refund.providerError || null,
        },
      });
    }

    return res.status(200).json({
      message: result.refund.message,
      refundRequest: result.request,
      refund: result.refund,
    });
  } catch (err) {
    if (err.statusCode === 409) {
      await auditService.log({
        eventType: "refund_approval_blocked",
        actorUserId: req.user.userId,
        targetType: "refund_request",
        targetId: req.params.id,
        ipAddress: req.ip,
        metadata: { reason: err.message },
      });
    }
    await auditService.log({
      eventType: "provider_refund_failed",
      actorUserId: req.user.userId,
      targetType: "refund_request",
      targetId: req.params.id,
      ipAddress: req.ip,
      metadata: { providerError: err.message },
    });
    return res.status(err.statusCode || 502).json({ error: err.message });
  }
}

module.exports = {
  approveRefundRequest,
  cancelRefundRequest,
  createRefundRequest,
  getMerchantRefundRequests,
  getAllRefundRequests,
  getMyRefundRequests,
  rejectRefundRequest,
};
