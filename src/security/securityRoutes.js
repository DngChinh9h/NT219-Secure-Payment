"use strict";

const express = require("express");
const { authenticate } = require("../gateway/authMiddleware");
const { requireAdmin } = require("../gateway/authzMiddleware");
const controller = require("./securityController");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/audit-chain/verify", controller.verifyAuditChain);
router.get("/evidence", controller.getEvidence);
router.get("/keys/status", controller.getReceiptSigningKeyStatus);
router.post("/keys/rotate", controller.rotateReceiptSigningKey);
router.post("/receipt/verify", controller.verifyReceipt);

module.exports = router;
