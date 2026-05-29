'use strict';

require('dotenv').config();

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const db = require('../db');
const orderService = require('../orders/orderService');
const { hmacSign, createSignedReceipt } = require('../crypto');

/**
 * Tạo Stripe PaymentIntent cho một order.
 *
 * Security goals:
 * - Chống IDOR: chỉ owner của order mới được thanh toán.
 * - Chống double-spend: atomic UPDATE chỉ cho 1 request chuyển pending -> processing.
 * - PCI-DSS: server chỉ nhận stripeToken dạng pm_xxx, không nhận số thẻ thật.
 */
async function createPaymentIntent({ orderId, stripeToken, amount, userId }) {
  let locked = false;

  try {
    /**
     * Atomic lock:
     * Chỉ request đầu tiên đúng owner + order đang pending mới lock được.
     * Các request đồng thời khác sẽ rowCount = 0.
     */
    const lockResult = await db.query(
      `UPDATE orders
       SET status = 'processing', updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status = 'pending'
       RETURNING *`,
      [orderId, userId]
    );

    if (lockResult.rowCount === 0) {
      /**
       * Phân biệt nguyên nhân fail để trả lỗi đúng:
       * - Không có order: 404
       * - Có order nhưng không phải owner: 403
       * - Đúng owner nhưng status không còn pending: 409
       */
      const orderCheck = await db.query(
        `SELECT id, user_id, status
         FROM orders
         WHERE id = $1
         LIMIT 1`,
        [orderId]
      );

      const existingOrder = orderCheck.rows[0];

      if (!existingOrder) {
        const err = new Error('Order not found');
        err.statusCode = 404;
        throw err;
      }

      if (existingOrder.user_id !== userId) {
        const err = new Error('Forbidden: order belongs to another user');
        err.statusCode = 403;
        throw err;
      }

      const err = new Error(
        `Order is already being processed or not available. Current status: ${existingOrder.status}`
      );
      err.statusCode = 409;
      throw err;
    }

    locked = true;
    const order = lockResult.rows[0];

    /**
     * Optional but important:
     * Không cho client tự ý gửi amount khác với amount của order trong DB.
     */
    if (Number(amount) !== Number(order.total_amount)) {
      const err = new Error('Payment amount does not match order total');
      err.statusCode = 400;
      throw err;
    }

    /**
     * Tạo PaymentIntent trên Stripe.
     * Lưu ý: stripeToken phải là pm_xxx từ Stripe.js / Stripe Elements.
     * Server tuyệt đối không nhận card number.
     */
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(order.total_amount),
      currency: 'vnd',
      payment_method: stripeToken,
      confirmation_method: 'manual',
      confirm: true,
      metadata: {
        orderId: order.id,
        userId: order.user_id,
      },
    });

    /**
     * Order đã là processing từ bước atomic lock.
     * Ở đây chỉ gắn Stripe PaymentIntent ID.
     */
    await db.query(
      `UPDATE orders
       SET stripe_payment_intent_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [paymentIntent.id, order.id]
    );

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
    };
  } catch (err) {
    /**
     * Nếu đã lock order sang processing nhưng Stripe call / amount check fail,
     * rollback về pending để user có thể thử lại.
     *
     * Chỉ rollback order của đúng user để tránh ảnh hưởng order người khác.
     */
    if (locked) {
      await db.query(
        `UPDATE orders
         SET status = 'pending',
             updated_at = NOW()
         WHERE id = $1
           AND user_id = $2
           AND status = 'processing'`,
        [orderId, userId]
      ).catch(() => {});
    }

    throw err;
  }
}

/**
 * Bổ sung HMAC signature và JWS receipt cho transaction.
 * Tách ra để confirmPayment() có thể dùng lại khi webhook bị gọi nhiều lần.
 */
async function attachSecurityArtifactsToTransaction({ tx, order, paymentIntentId, last4 }) {
  let signature = tx.hmac_signature;
  let jws = tx.jws_receipt;

  if (!signature) {
    signature = hmacSign({
      txId: tx.id,
      orderId: order.id,
      paymentIntentId,
      amount: order.total_amount,
      createdAt: tx.created_at,
    });

    await db.query(
      'UPDATE transactions SET hmac_signature = $1 WHERE id = $2',
      [signature, tx.id]
    );
  }

  if (!jws) {
    jws = createSignedReceipt({
      txId: tx.id,
      orderId: order.id,
      userId: order.user_id,
      amount: order.total_amount,
      currency: 'vnd',
      last4,
    });

    await db.query(
      'UPDATE transactions SET jws_receipt = $1 WHERE id = $2',
      [jws, tx.id]
    );
  }

  return {
    ...tx,
    hmac_signature: signature,
    jws_receipt: jws,
  };
}

/**
 * Xử lý khi Stripe webhook báo payment_intent.succeeded.
 *
 * Security goals:
 * - Verify webhook đã được làm ở webhookHandler bằng constructEvent().
 * - Idempotent: Stripe có thể gửi webhook lại nhiều lần, không tạo duplicate transaction.
 * - Ghi HMAC để đảm bảo integrity transaction.
 * - Tạo JWS signed receipt để demo chữ ký số / non-repudiation.
 */
async function confirmPayment(paymentIntentId, last4 = null) {
  const orderResult = await db.query(
    `SELECT *
     FROM orders
     WHERE stripe_payment_intent_id = $1
     LIMIT 1`,
    [paymentIntentId]
  );

  const order = orderResult.rows[0];

  if (!order) {
    const err = new Error(`No order for paymentIntent: ${paymentIntentId}`);
    err.statusCode = 404;
    throw err;
  }

  /**
   * Webhook có thể retry.
   * Nếu transaction đã tồn tại, không insert thêm.
   */
  const existingTxResult = await db.query(
    `SELECT *
     FROM transactions
     WHERE stripe_payment_id = $1
     LIMIT 1`,
    [paymentIntentId]
  );

  if (existingTxResult.rowCount > 0) {
    const existingTx = existingTxResult.rows[0];

    /**
     * Đảm bảo order đã paid.
     * Nếu đã paid rồi thì updateOrderStatus vẫn nên không gây hại.
     */
    if (order.status !== 'paid') {
      await orderService.updateOrderStatus(order.id, 'paid', paymentIntentId);
    }

    return attachSecurityArtifactsToTransaction({
      tx: existingTx,
      order,
      paymentIntentId,
      last4: last4 || existingTx.stripe_token_last4 || null,
    });
  }

  /**
   * Chưa có transaction thì cập nhật order paid và tạo transaction mới.
   */
  await orderService.updateOrderStatus(order.id, 'paid', paymentIntentId);

  const txResult = await db.query(
    `INSERT INTO transactions
      (order_id, user_id, stripe_payment_id, amount, currency, status, stripe_token_last4)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      order.id,
      order.user_id,
      paymentIntentId,
      order.total_amount,
      'vnd',
      'success',
      last4,
    ]
  );

  const tx = txResult.rows[0];

  return attachSecurityArtifactsToTransaction({
    tx,
    order,
    paymentIntentId,
    last4,
  });
}

module.exports = {
  createPaymentIntent,
  confirmPayment,
};