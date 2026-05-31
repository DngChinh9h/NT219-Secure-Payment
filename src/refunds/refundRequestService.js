"use strict";

const db = require("../db");
const paymentService = require("../payments/paymentService");

function createError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function findRequestById(id) {
  const result = await db.query(
    `SELECT *
     FROM refund_requests
     WHERE id = $1
     LIMIT 1`,
    [id],
  );

  return result.rows[0] || null;
}

async function createRefundRequest({ orderId, reason, details = null, userId }) {
  const orderResult = await db.query(
    `SELECT *
     FROM orders
     WHERE id = $1
     LIMIT 1`,
    [orderId],
  );
  const order = orderResult.rows[0];

  if (!order) {
    throw createError("Order not found", 404);
  }

  if (order.user_id !== userId) {
    throw createError("Forbidden: order belongs to another user", 403);
  }

  if (order.status !== "paid") {
    throw createError(
      `Only paid orders can request a refund. Current status: ${order.status}`,
      409,
    );
  }

  const txResult = await db.query(
    `SELECT *
     FROM transactions
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId],
  );
  const tx = txResult.rows[0];

  if (!tx) {
    throw createError("Successful transaction not found for order", 409);
  }

  if (tx.status === "refunded") {
    throw createError("Transaction already refunded", 409);
  }

  if (tx.status !== "success") {
    throw createError(
      `Only successful transactions can request a refund. Current status: ${tx.status}`,
      409,
    );
  }

  const activeResult = await db.query(
    `SELECT id
     FROM refund_requests
     WHERE order_id = $1
       AND status IN ('pending_review', 'approved_processing')
     LIMIT 1`,
    [orderId],
  );

  if (activeResult.rowCount > 0) {
    throw createError("Active refund request already exists for order", 409);
  }

  try {
    const insertResult = await db.query(
      `INSERT INTO refund_requests
        (order_id, transaction_id, user_id, amount, provider,
         provider_payment_id, reason, details, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review')
       RETURNING *`,
      [
        order.id,
        tx.id,
        userId,
        tx.amount,
        tx.provider || order.payment_provider || "stripe",
        tx.provider_payment_id || tx.stripe_payment_id || null,
        reason,
        details || null,
      ],
    );

    return insertResult.rows[0];
  } catch (err) {
    if (err.code === "23505") {
      throw createError("Active refund request already exists for order", 409);
    }
    throw err;
  }
}

async function getMyRefundRequests(userId) {
  const result = await db.query(
    `SELECT *
     FROM refund_requests
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return result.rows;
}

async function cancelRefundRequest({ requestId, userId }) {
  const request = await findRequestById(requestId);

  if (!request) {
    throw createError("Refund request not found", 404);
  }

  if (request.user_id !== userId) {
    throw createError("Forbidden: refund request belongs to another user", 403);
  }

  if (request.status !== "pending_review") {
    throw createError(
      `Only pending_review refund requests can be cancelled. Current status: ${request.status}`,
      409,
    );
  }

  const result = await db.query(
    `UPDATE refund_requests
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending_review'
     RETURNING *`,
    [requestId],
  );

  if (result.rowCount === 0) {
    throw createError("Refund request is no longer pending review", 409);
  }

  return result.rows[0];
}

async function getAllRefundRequests() {
  const result = await db.query(
    `SELECT rr.*,
            o.status AS order_status,
            u.email AS user_email,
            t.status AS transaction_status,
            t.refund_id AS transaction_refund_id,
            t.refunded_at AS transaction_refunded_at
     FROM refund_requests rr
     JOIN orders o ON o.id = rr.order_id
     JOIN users u ON u.id = rr.user_id
     LEFT JOIN transactions t ON t.id = rr.transaction_id
     ORDER BY rr.created_at DESC`,
  );

  return result.rows;
}

async function rejectRefundRequest({ requestId, adminNote, adminUserId }) {
  const result = await db.query(
    `UPDATE refund_requests
     SET status = 'rejected',
         admin_note = $2,
         reviewed_by = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending_review'
     RETURNING *`,
    [requestId, adminNote, adminUserId],
  );

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  const request = await findRequestById(requestId);
  if (!request) {
    throw createError("Refund request not found", 404);
  }

  throw createError(
    `Only pending_review refund requests can be rejected. Current status: ${request.status}`,
    409,
  );
}

async function approveRefundRequest({ requestId, adminUserId }) {
  const claimResult = await db.query(
    `UPDATE refund_requests
     SET status = 'approved_processing',
         reviewed_by = $2,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending_review'
     RETURNING *`,
    [requestId, adminUserId],
  );

  if (claimResult.rowCount === 0) {
    const request = await findRequestById(requestId);
    if (!request) {
      throw createError("Refund request not found", 404);
    }

    throw createError(
      `Only pending_review refund requests can be approved. Current status: ${request.status}`,
      409,
    );
  }

  const request = claimResult.rows[0];

  try {
    const refundResult = await paymentService.refundTransaction({
      transactionId: request.transaction_id,
      reason: request.reason,
      userId: adminUserId,
      role: "admin",
    });

    const updateResult = await db.query(
      `UPDATE refund_requests
       SET status = 'succeeded',
           provider_refund_id = $2,
           provider_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId, refundResult.refundId],
    );

    return {
      request: updateResult.rows[0],
      refund: refundResult,
    };
  } catch (err) {
    await db
      .query(
        `UPDATE refund_requests
         SET status = 'provider_failed',
             provider_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [requestId, err.message],
      )
      .catch(() => {});

    throw err;
  }
}

module.exports = {
  approveRefundRequest,
  cancelRefundRequest,
  createRefundRequest,
  findRequestById,
  getAllRefundRequests,
  getMyRefundRequests,
  rejectRefundRequest,
};
