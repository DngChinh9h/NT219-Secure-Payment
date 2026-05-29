'use strict';

const WINDOW_MS = 5 * 60 * 1000; // 5 phút
const usedNonces = new Set();
const nonceTimers = new Map();

/**
 * Validate nonce + timestamp để chống replay attack.
 *
 * @param {string} nonce - UUID random từ client, chỉ dùng một lần
 * @param {number|string} timestamp - Date.now() từ client
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateNonce(nonce, timestamp) {
  if (!nonce || !timestamp) {
    return {
      valid: false,
      reason: 'Missing nonce or timestamp',
    };
  }

  const ts = Number(timestamp);

  if (!Number.isFinite(ts)) {
    return {
      valid: false,
      reason: 'Invalid timestamp',
    };
  }

  const now = Date.now();

  if (Math.abs(now - ts) > WINDOW_MS) {
    return {
      valid: false,
      reason: 'Request expired or timestamp is too far from server time',
    };
  }

  if (usedNonces.has(nonce)) {
    return {
      valid: false,
      reason: 'Replay attack detected: nonce already used',
    };
  }

  usedNonces.add(nonce);

  /**
   * Tự xóa nonce sau cửa sổ 5 phút.
   *
   * Quan trọng:
   * - .unref() để timer này không giữ Node/Jest sống.
   * - Lưu timer vào Map để test có thể clear sạch bằng _clearNonces().
   */
  const timer = setTimeout(() => {
    usedNonces.delete(nonce);
    nonceTimers.delete(nonce);
  }, WINDOW_MS + 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  nonceTimers.set(nonce, timer);

  return {
    valid: true,
  };
}

/**
 * Chỉ dùng cho test.
 * Xóa toàn bộ nonce và clear toàn bộ timer để Jest không bị open handle.
 */
function _clearNonces() {
  for (const timer of nonceTimers.values()) {
    clearTimeout(timer);
  }

  nonceTimers.clear();
  usedNonces.clear();
}

module.exports = {
  validateNonce,
  _clearNonces,
};