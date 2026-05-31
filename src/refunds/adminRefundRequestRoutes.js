"use strict";

const express = require("express");
const { authenticate } = require("../gateway/authMiddleware");
const { requireAdmin } = require("../gateway/authzMiddleware");
const {
  validate,
  validateParams,
  refundRequestRejectSchema,
  refundRequestIdSchema,
} = require("../crypto");
const controller = require("./refundRequestController");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/refund-requests", controller.getAllRefundRequests);
router.post(
  "/refund-requests/:id/reject",
  validateParams(refundRequestIdSchema),
  validate(refundRequestRejectSchema),
  controller.rejectRefundRequest,
);
router.post(
  "/refund-requests/:id/approve",
  validateParams(refundRequestIdSchema),
  controller.approveRefundRequest,
);

module.exports = router;
