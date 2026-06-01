"use strict";

const auditService = require("../transactions/auditService");
const { verifyReceipt: verifySignedReceipt } = require("../crypto");
const securityEvidenceService = require("./securityEvidenceService");

async function verifyAuditChain(req, res) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 1000;
    const result = await auditService.verifyAuditChain({ limit });
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ error: "Failed to verify audit chain" });
  }
}

async function getEvidence(req, res) {
  try {
    const evidence = await securityEvidenceService.getSecurityEvidence();
    return res.status(200).json(evidence);
  } catch {
    return res.status(500).json({ error: "Failed to get security evidence" });
  }
}

async function verifyReceipt(req, res) {
  try {
    const { receipt } = req.body || {};

    if (!receipt || typeof receipt !== "string") {
      await auditService.log({
        eventType: "receipt_verified",
        actorUserId: req.user.userId,
        targetType: "receipt",
        metadata: { valid: false, reason: "missing_or_invalid_receipt" },
        ipAddress: req.ip,
      });
      return res.status(400).json({ valid: false, error: "Invalid receipt" });
    }

    const payload = verifySignedReceipt(receipt);
    await auditService.log({
      eventType: "receipt_verified",
      actorUserId: req.user.userId,
      targetType: "transaction",
      targetId: payload.txId || null,
      metadata: { valid: true },
      ipAddress: req.ip,
    });

    return res.status(200).json({ valid: true, payload });
  } catch {
    await auditService.log({
      eventType: "receipt_verified",
      actorUserId: req.user.userId,
      targetType: "receipt",
      metadata: { valid: false, reason: "verification_failed" },
      ipAddress: req.ip,
    });
    return res.status(200).json({ valid: false, error: "Invalid receipt" });
  }
}

module.exports = {
  getEvidence,
  verifyAuditChain,
  verifyReceipt,
};
