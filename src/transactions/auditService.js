'use strict';
const db = require('../db');
const { hmacSign } = require('../crypto');

async function log({ eventType, userId = null, ipAddress = null, userAgent = null, payload = {} }) {
  try {
    const hmacSig = hmacSign({
      eventType,
      userId,
      payload,
      timestamp: new Date().toISOString()
    });

    await db.query(
      `INSERT INTO audit_logs (event_type, user_id, ip_address, user_agent, payload, hmac_sig)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [eventType, userId, ipAddress, userAgent, JSON.stringify(payload), hmacSig]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

async function getLogs({ userId = null, eventType = null, limit = 50 } = {}) {
  let query  = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  let idx = 1;

  if (userId) {
    query += ` AND user_id = $${idx++}`;
    params.push(userId);
  }
  if (eventType) {
    query += ` AND event_type = $${idx++}`;
    params.push(eventType);
  }

  query += ` ORDER BY created_at DESC LIMIT $${idx}`;
  params.push(limit);

  const result = await db.query(query, params);
  return result.rows;
}

function verifyLogIntegrity(logRow) {
  const expectedSig = hmacSign({
    eventType: logRow.event_type,
    userId:    logRow.user_id,
    payload:   logRow.payload,
    timestamp: logRow.created_at.toISOString()
  });
  return expectedSig === logRow.hmac_sig;
}

module.exports = { log, getLogs, verifyLogIntegrity };
