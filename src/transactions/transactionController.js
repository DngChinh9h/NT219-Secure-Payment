'use strict';
const db = require('../db');
const { verifyReceipt: verifySignedReceipt } = require('../crypto');

async function getMyTransactions(req, res) {
  try {
    const result = await db.query(
      `SELECT t.id, t.amount, t.currency, t.status,
              t.provider, t.provider_payment_id,
              t.refund_id, t.refunded_at, t.refund_reason,
              t.stripe_token_last4, t.jws_receipt, t.created_at,
              o.id as order_id
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 20`,
      [req.user.userId]
    );
    return res.status(200).json({ transactions: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get transactions' });
  }
}

async function getAuditLogs(req, res) {
  try {
    const auditService = require('./auditService');
    const logs = await auditService.getLogs({ limit: 100 });
    return res.status(200).json({ logs });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get audit logs' });
  }
}

async function verifyAuditLogs(req, res) {
  try {
    const auditService = require('./auditService');
    const limit = req.query.limit ? Number(req.query.limit) : 1000;
    const result = await auditService.verifyAuditChain({ limit });
    return res.status(200).json(
      result.valid
        ? result
        : { ...result, failedAt: result.brokenAt || result.failedAt },
    );
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify audit logs' });
  }
}

async function getReceipt(req, res) {
  try {
    const result = await db.query(
      `SELECT id, jws_receipt
       FROM transactions
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [req.params.id, req.user.userId]
    );

    const tx = result.rows[0];

    if (!tx || !tx.jws_receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    return res.status(200).json({ receipt: tx.jws_receipt });
  } catch (err) {
    console.error("getReceipt error:", err);
    return res.status(500).json({ error: "Failed to get receipt" });
  }
}

async function verifyReceipt(req, res) {
  const auditService = require('./auditService');

  try {
    const { receipt } = req.body || {};

    if (!receipt || typeof receipt !== "string") {
      await auditService.log({
        eventType: "receipt_verified",
        targetType: "receipt",
        metadata: { valid: false, reason: "missing_or_invalid_receipt" },
      });

      return res.status(400).json({
        valid: false,
        error: "Invalid receipt",
      });
    }

    const payload = await verifySignedReceipt(receipt);
    await auditService.log({
      eventType: "receipt_verified",
      actorUserId: payload.userId || null,
      targetType: "transaction",
      targetId: payload.txId || null,
      metadata: { valid: true },
    });

    return res.status(200).json({ valid: true, payload });
  } catch (err) {
    await auditService.log({
      eventType: "receipt_verified",
      targetType: "receipt",
      metadata: { valid: false, reason: err.message },
    });

    return res.status(200).json({
      valid: false,
      error: "Invalid receipt",
    });
  }
}

module.exports = {
  getMyTransactions,
  getAuditLogs,
  verifyAuditLogs,
  getReceipt,
  verifyReceipt,
};
