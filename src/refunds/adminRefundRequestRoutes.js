"use strict";

const express = require("express");
const { authenticate } = require("../gateway/authMiddleware");
const { requireAdmin } = require("../gateway/authzMiddleware");
const {
  validate,
  validateParams,
  refundRequestApproveSchema,
  refundRequestRejectSchema,
  refundRequestIdSchema,
} = require("../crypto");
const controller = require("./refundRequestController");
const { adminRefundLimiter } = require("../gateway/rateLimiter");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/refund-requests", controller.getAllRefundRequests);
router.post(
  "/refund-requests/:id/reject",
  adminRefundLimiter,
  validateParams(refundRequestIdSchema),
  validate(refundRequestRejectSchema),
  controller.rejectRefundRequest,
);
router.post(
  "/refund-requests/:id/approve",
  adminRefundLimiter,
  validateParams(refundRequestIdSchema),
  validate(refundRequestApproveSchema),
  controller.approveRefundRequest,
);

module.exports = router;
