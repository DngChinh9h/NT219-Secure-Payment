"use strict";

const crypto = require("crypto");
const db = require("../db");
const { hmacSign } = require("../crypto");

const CHAIN_VERSION = "sha256_v1";
const GENESIS_HASH = "GENESIS";
const AUDIT_LOCK_ID = 219004;

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return metadata;
    }
  }
  return metadata;
}

function buildCanonicalEvent({
  id,
  eventType,
  actorUserId,
  targetType,
  targetId,
  metadata,
  createdAt,
}) {
  return stableStringify({
    id,
    eventType,
    actorUserId: actorUserId || null,
    targetType: targetType || null,
    targetId: targetId || null,
    metadata: normalizeMetadata(metadata),
    createdAt: normalizeTimestamp(createdAt),
  });
}

function calculateCurrentHash({ prevHash, ...event }) {
  return crypto
    .createHash("sha256")
    .update(`${prevHash}${buildCanonicalEvent(event)}`)
    .digest("hex");
}

// Legacy verifier retained so previously deployed audit rows remain verifiable.
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
    payload: normalizeMetadata(payload),
    createdAt: normalizeTimestamp(createdAt),
    previousHash,
  });
}

async function log({
  eventType,
  actorUserId = null,
  userId = null,
  targetType = null,
  targetId = null,
  metadata,
  payload,
  ipAddress = null,
  userAgent = null,
}) {
  let client;

  try {
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const normalizedActorUserId = actorUserId || userId || null;
    const normalizedMetadata = normalizeMetadata(metadata ?? payload);
    client = await db.connect();

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_LOCK_ID]);

    const previousResult = await client.query(
      `SELECT current_hash
       FROM audit_logs
       WHERE current_hash IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    );
    const prevHash = previousResult.rows[0]?.current_hash || GENESIS_HASH;
    const currentHash = calculateCurrentHash({
      prevHash,
      id,
      eventType,
      actorUserId: normalizedActorUserId,
      targetType,
      targetId,
      metadata: normalizedMetadata,
      createdAt,
    });
    const hmacSig = hmacSign({
      eventType,
      userId: normalizedActorUserId,
      payload: normalizedMetadata,
      timestamp: createdAt.toISOString(),
    });

    await client.query(
      `INSERT INTO audit_logs
        (id, event_type, user_id, actor_user_id, target_type, target_id,
         ip_address, user_agent, payload, metadata, hmac_sig, previous_hash,
         prev_hash, current_hash, chain_version, created_at)
       VALUES
        ($1, $2, $3, $3, $4, $5, $6, $7, $8, $8, $9, $10, $10, $11, $12, $13)`,
      [
        id,
        eventType,
        normalizedActorUserId,
        targetType,
        targetId,
        ipAddress,
        userAgent,
        JSON.stringify(normalizedMetadata),
        hmacSig,
        prevHash,
        currentHash,
        CHAIN_VERSION,
        createdAt.toISOString(),
      ],
    );
    await client.query("COMMIT");

    return {
      id,
      event_type: eventType,
      actor_user_id: normalizedActorUserId,
      target_type: targetType,
      target_id: targetId,
      metadata: normalizedMetadata,
      created_at: createdAt.toISOString(),
      prev_hash: prevHash,
      current_hash: currentHash,
      chain_version: CHAIN_VERSION,
    };
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.error("Audit log error:", err.message);
    return null;
  } finally {
    client?.release();
  }
}

async function getLogs({ userId = null, eventType = null, limit = 50 } = {}) {
  let query = "SELECT * FROM audit_logs WHERE 1=1";
  const params = [];
  let idx = 1;

  if (userId) {
    query += ` AND COALESCE(actor_user_id, user_id) = $${idx++}`;
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

async function getLatestEvidenceTimestamps(eventTypes) {
  const result = await db.query(
    `SELECT event_type, MAX(created_at) AS latest_at
     FROM audit_logs
     WHERE event_type = ANY($1)
     GROUP BY event_type`,
    [eventTypes],
  );

  return Object.fromEntries(
    eventTypes.map((eventType) => [
      eventType,
      result.rows.find((row) => row.event_type === eventType)?.latest_at || null,
    ]),
  );
}

function verifyLogIntegrity(logRow) {
  const expectedSig = hmacSign({
    eventType: logRow.event_type,
    userId: logRow.user_id,
    payload: logRow.payload,
    timestamp: normalizeTimestamp(logRow.created_at),
  });
  return expectedSig === logRow.hmac_sig;
}

function getRowPrevHash(row) {
  return row.prev_hash || row.previous_hash;
}

function verifySha256Row(row) {
  return calculateCurrentHash({
    prevHash: getRowPrevHash(row),
    id: row.id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id || row.user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata ?? row.payload,
    createdAt: row.created_at,
  });
}

function verifyLegacyRow(row) {
  return hmacSign(
    buildHashPayload({
      eventType: row.event_type,
      userId: row.user_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      payload: row.payload,
      createdAt: row.created_at,
      previousHash: row.previous_hash,
    }),
  );
}

async function verifyAuditChain({ limit = 1000 } = {}) {
  const result = await db.query(
    `SELECT *
     FROM audit_logs
     WHERE current_hash IS NOT NULL
     ORDER BY created_at ASC, id ASC
     LIMIT $1`,
    [limit],
  );

  let previousHash = GENESIS_HASH;
  let checked = 0;

  for (const row of result.rows) {
    checked += 1;

    if (getRowPrevHash(row) !== previousHash) {
      return { valid: false, checked, brokenAt: row.id };
    }

    const expectedHash =
      row.chain_version === CHAIN_VERSION
        ? verifySha256Row(row)
        : verifyLegacyRow(row);

    if (expectedHash !== row.current_hash) {
      return { valid: false, checked, brokenAt: row.id };
    }

    previousHash = row.current_hash;
  }

  return { valid: true, checked, brokenAt: null };
}

module.exports = {
  AUDIT_LOCK_ID,
  CHAIN_VERSION,
  GENESIS_HASH,
  buildCanonicalEvent,
  buildHashPayload,
  calculateCurrentHash,
  getLatestEvidenceTimestamps,
  getLogs,
  log,
  stableStringify,
  verifyAuditChain,
  verifyLogIntegrity,
};
