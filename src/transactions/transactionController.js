'use strict';
const db = require('../db');

async function getMyTransactions(req, res) {
  try {
    const result = await db.query(
      `SELECT t.id, t.amount, t.currency, t.status,
              t.stripe_token_last4, t.created_at,
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

module.exports = { getMyTransactions, getAuditLogs };
