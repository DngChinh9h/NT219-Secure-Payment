"use strict";

const express = require("express");
const { authenticate } = require("../gateway/authMiddleware");
const { requireAdmin } = require("../gateway/authzMiddleware");
const controller = require("./adminOperationsController");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/orders", controller.getOrders);
router.get("/transactions", controller.getTransactions);
router.get("/provider-events", controller.getProviderEvents);

module.exports = router;
