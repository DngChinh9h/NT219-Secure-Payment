'use strict';
const db = require('../db');
const { hmacSign } = require('../crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }
  return payload;
}

function buildHashPayload({
  eventType,
  userId,
  ipAddress,
  userAgent,
  payload,
  createdAt,
  previousHash,
}) {
  return stableStringify({
    eventType,
    userId: userId || null,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    payload: normalizePayload(payload),
    createdAt: normalizeTimestamp(createdAt),
    previousHash,
  });
}

async function log({ eventType, userId = null, ipAddress = null, userAgent = null, payload = {} }) {
  try {
    const createdAt = new Date();
    const previousResult = await db.query(
      `SELECT current_hash
       FROM audit_logs
       WHERE current_hash IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    );
    const previousHash = previousResult.rows[0]?.current_hash || 'GENESIS';
    const currentHash = hmacSign(buildHashPayload({
      eventType,
      userId,
      ipAddress,
      userAgent,
      payload,
      createdAt,
      previousHash,
    }));
    const hmacSig = hmacSign({
      eventType,
      userId,
      payload,
      timestamp: createdAt.toISOString()
    });

    await db.query(
      `INSERT INTO audit_logs
        (event_type, user_id, ip_address, user_agent, payload, hmac_sig,
         previous_hash, current_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        eventType,
        userId,
        ipAddress,
        userAgent,
        JSON.stringify(payload),
        hmacSig,
        previousHash,
        currentHash,
        createdAt.toISOString(),
      ]
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

async function verifyAuditChain({ limit = 1000 } = {}) {
  const result = await db.query(
    `SELECT *
     FROM audit_logs
     WHERE current_hash IS NOT NULL
     ORDER BY created_at ASC, id ASC
     LIMIT $1`,
    [limit]
  );

  let previousHash = 'GENESIS';
  let checked = 0;

  for (const row of result.rows) {
    checked += 1;

    if (row.previous_hash !== previousHash) {
      return {
        valid: false,
        checked,
        failedAt: row.id,
      };
    }

    const expectedHash = hmacSign(buildHashPayload({
      eventType: row.event_type,
      userId: row.user_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      payload: row.payload,
      createdAt: row.created_at,
      previousHash: row.previous_hash,
    }));

    if (expectedHash !== row.current_hash) {
      return {
        valid: false,
        checked,
        failedAt: row.id,
      };
    }

    previousHash = row.current_hash;
  }

  return { valid: true, checked };
}

module.exports = {
  log,
  getLogs,
  verifyLogIntegrity,
  verifyAuditChain,
  buildHashPayload,
  stableStringify,
};
