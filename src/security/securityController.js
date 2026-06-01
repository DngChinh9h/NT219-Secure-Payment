"use strict";

const auditService = require("../transactions/auditService");
const { verifyReceipt: verifySignedReceipt } = require("../crypto");
const signingKeyService = require("../crypto/receiptSigningKeyService");
const securityEvidenceService = require("./securityEvidenceService");
const securityHardeningService = require("./securityHardeningService");
const reconciliationService = require("./reconciliationService");
const riskEvidenceService = require("./riskEvidenceService");

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

function getHardening(req, res) {
  try {
    return res
      .status(200)
      .json(securityHardeningService.getSecurityHardeningEvidence());
  } catch {
    return res.status(500).json({ error: "Failed to get security hardening evidence" });
  }
}

async function getReconciliation(req, res) {
  try {
    return res
      .status(200)
      .json(await reconciliationService.getReconciliationSummary());
  } catch {
    return res.status(500).json({ error: "Failed to reconcile payment records" });
  }
}

async function getRiskEvidence(req, res) {
  try {
    return res.status(200).json(await riskEvidenceService.getRiskEvidence());
  } catch {
    return res.status(500).json({ error: "Failed to get fraud risk evidence" });
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

    const payload = await verifySignedReceipt(receipt);
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

async function getReceiptSigningKeyStatus(req, res) {
  try {
    const status = await signingKeyService.getKeyStatus();
    return res.status(200).json(status);
  } catch {
    return res.status(500).json({ error: "Failed to get receipt signing key status" });
  }
}

async function rotateReceiptSigningKey(req, res) {
  try {
    const status = await signingKeyService.rotateSigningKey();
    await auditService.log({
      eventType: "receipt_signing_key_rotated",
      actorUserId: req.user.userId,
      targetType: "receipt_signing_key",
      targetId: String(status.activeKeyVersion),
      metadata: { keyVersion: status.activeKeyVersion },
      ipAddress: req.ip,
    });

    return res.status(200).json(status);
  } catch {
    return res.status(500).json({ error: "Failed to rotate receipt signing key" });
  }
}

module.exports = {
  getEvidence,
  getHardening,
  getReconciliation,
  getReceiptSigningKeyStatus,
  getRiskEvidence,
  rotateReceiptSigningKey,
  verifyAuditChain,
  verifyReceipt,
};
