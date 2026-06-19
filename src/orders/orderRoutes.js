"use strict";

const express = require("express");
const { authenticate } = require("../gateway/authMiddleware");
const { validate, orderSchema } = require("../crypto");
const ctrl = require("./orderController");

const router = express.Router();

router.use(authenticate);

router.post("/", validate(orderSchema), ctrl.createOrder);
router.get("/mine", ctrl.getMyOrders);
router.get("/merchant", ctrl.getMerchantOrders);
router.get("/:id", ctrl.getOrder);

module.exports = router;
