"use strict";

const db = require("../db");

async function findEvent({ provider, providerEventId }) {
  const result = await db.query(
    `SELECT *
     FROM webhook_events
     WHERE provider = $1
       AND provider_event_id = $2
     LIMIT 1`,
    [provider, providerEventId],
  );

  return result.rows[0] || null;
}

async function recordReceivedEvent({
  provider,
  providerEventId,
  eventType,
  providerPaymentId,
  rawPayload,
}) {
  const insertResult = await db.query(
    `INSERT INTO webhook_events
      (provider, provider_event_id, event_type, provider_payment_id,
       processing_status, raw_payload)
     VALUES ($1, $2, $3, $4, 'received', $5)
     ON CONFLICT (provider, provider_event_id) DO NOTHING
     RETURNING *`,
    [
      provider,
      providerEventId,
      eventType,
      providerPaymentId || null,
      rawPayload || null,
    ],
  );

  if (insertResult.rowCount > 0) {
    return insertResult.rows[0];
  }

  return findEvent({ provider, providerEventId });
}

async function markProcessed({ provider, providerEventId }) {
  const result = await db.query(
    `UPDATE webhook_events
     SET processing_status = 'processed',
         error_message = NULL,
         processed_at = NOW()
     WHERE provider = $1
       AND provider_event_id = $2
     RETURNING *`,
    [provider, providerEventId],
  );

  return result.rows[0] || null;
}

async function markFailed({ provider, providerEventId, errorMessage }) {
  const result = await db.query(
    `UPDATE webhook_events
     SET processing_status = 'failed',
         error_message = $3
     WHERE provider = $1
       AND provider_event_id = $2
     RETURNING *`,
    [provider, providerEventId, errorMessage],
  );

  return result.rows[0] || null;
}

module.exports = {
  recordReceivedEvent,
  markProcessed,
  markFailed,
  findEvent,
};
