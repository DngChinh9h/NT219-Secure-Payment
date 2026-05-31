"use strict";

const express = require("express");
const { authenticate } = require("../gateway/authMiddleware");
const {
  validate,
  validateParams,
  refundRequestSchema,
  refundRequestIdSchema,
} = require("../crypto");
const controller = require("./refundRequestController");

const router = express.Router();

router.use(authenticate);

router.post("/", validate(refundRequestSchema), controller.createRefundRequest);
router.get("/mine", controller.getMyRefundRequests);
router.post(
  "/:id/cancel",
  validateParams(refundRequestIdSchema),
  controller.cancelRefundRequest,
);

module.exports = router;
