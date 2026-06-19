"use strict";

const db = require("../db");
const { verifyReceipt: verifySignedReceipt } = require("../crypto");
const auditService = require("./auditService");

async function getMyTransactions(req, res) {
  try {
    const result = await db.query(
      `SELECT t.id, t.order_id, t.payer_user_id, t.merchant_id,
              t.amount, t.currency, t.status, t.provider, t.provider_payment_id,
              t.refund_id, t.refunded_at, t.refund_reason,
              t.stripe_token_last4, t.jws_receipt, t.receipt_id,
              t.order_items_hash, t.created_at
       FROM transactions t
       WHERE t.payer_user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.user.userId],
    );
    return res.status(200).json({ transactions: result.rows });
  } catch {
    return res.status(500).json({ error: "Failed to get transactions" });
  }
}

async function getMerchantTransactions(req, res) {
  try {
    if (!["merchant", "admin"].includes(req.user.role)) {
      await auditService.log({
        eventType: "rbac_violation",
        actorUserId: req.user.userId,
        targetType: "transactions",
        metadata: { route: "merchant_transactions", role: req.user.role },
        ipAddress: req.ip,
      });
      return res.status(403).json({ error: "Requires role: merchant or admin" });
    }

    const params = [];
    let where = "";
    if (req.user.role !== "admin") {
      params.push(req.user.userId);
      where = "WHERE m.user_id = $1";
    }

    const result = await db.query(
      `SELECT t.id, t.order_id, t.payer_user_id, t.merchant_id,
              u.email AS customer_email, t.amount, t.currency, t.status,
              t.provider, t.provider_payment_id, t.refund_id,
              t.refunded_at, t.receipt_id, t.created_at
       FROM transactions t
       JOIN merchants m ON m.id = t.merchant_id
       JOIN users u ON u.id = t.payer_user_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT 200`,
      params,
    );

    return res.status(200).json({ transactions: result.rows });
  } catch {
    return res.status(500).json({ error: "Failed to get merchant transactions" });
  }
}

async function getAuditLogs(req, res) {
  try {
    const logs = await auditService.getLogs({ limit: 100 });
    return res.status(200).json({ logs });
  } catch {
    return res.status(500).json({ error: "Failed to get audit logs" });
  }
}

async function verifyAuditLogs(req, res) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 1000;
    const result = await auditService.verifyAuditChain({ limit });
    return res.status(200).json(
      result.valid ? result : { ...result, failedAt: result.brokenAt || result.failedAt },
    );
  } catch {
    return res.status(500).json({ error: "Failed to verify audit logs" });
  }
}

async function findTransactionForReceipt({ transactionId, user }) {
  const result = await db.query(
    `SELECT t.*, m.user_id AS merchant_user_id
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     WHERE t.id = $1
     LIMIT 1`,
    [transactionId],
  );
  const tx = result.rows[0];
  if (!tx) return null;

  if (
    user.role === "admin" ||
    tx.payer_user_id === user.userId ||
    (user.role === "merchant" && tx.merchant_user_id === user.userId)
  ) {
    return tx;
  }

  await auditService.log({
    eventType: "ownership_violation",
    actorUserId: user.userId,
    targetType: "transaction",
    targetId: transactionId,
    metadata: { route: "receipt", role: user.role },
  });
  return false;
}

async function getReceipt(req, res) {
  try {
    const tx = await findTransactionForReceipt({
      transactionId: req.params.id,
      user: req.user,
    });

    if (tx === false) {
      return res.status(403).json({ error: "Forbidden: receipt is not accessible" });
    }
    if (!tx || !tx.jws_receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    return res.status(200).json({ receipt: tx.jws_receipt });
  } catch {
    return res.status(500).json({ error: "Failed to get receipt" });
  }
}

async function verifyReceipt(req, res) {
  try {
    const { receipt } = req.body || {};

    if (!receipt || typeof receipt !== "string") {
      await auditService.log({
        eventType: "receipt_verified",
        targetType: "receipt",
        metadata: { valid: false, reason: "missing_or_invalid_receipt" },
      });
      return res.status(400).json({ valid: false, error: "Invalid receipt" });
    }

    const payload = await verifySignedReceipt(receipt);
    await auditService.log({
      eventType: "receipt_verified",
      actorUserId: payload.payer_user_id || payload.userId || null,
      targetType: "transaction",
      targetId: payload.transaction_id || payload.txId || null,
      metadata: {
        valid: true,
        receiptId: payload.receipt_id || null,
        merchantId: payload.merchant_id || null,
      },
    });

    return res.status(200).json({ valid: true, payload });
  } catch (err) {
    await auditService.log({
      eventType: "receipt_verified",
      targetType: "receipt",
      metadata: { valid: false, reason: err.message },
    });

    return res.status(200).json({ valid: false, error: "Invalid receipt" });
  }
}

module.exports = {
  getAuditLogs,
  getMerchantTransactions,
  getMyTransactions,
  getReceipt,
  verifyAuditLogs,
  verifyReceipt,
};
