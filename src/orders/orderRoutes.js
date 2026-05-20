"use strict";
const express = require("express");
const router = express.Router();
const { authenticate } = require("../gateway/authMiddleware");
const { requireOwnership } = require("../gateway/authzMiddleware");
const { validate, orderSchema } = require("../crypto");
const ctrl = require("./orderController");

// Tất cả route orders cần authenticate
router.use(authenticate);

router.post("/", validate(orderSchema), ctrl.createOrder);
router.get("/mine", ctrl.getMyOrders);
router.get("/:id", requireOwnership(ctrl.getOrderUserId), ctrl.getOrder);

module.exports = router;
