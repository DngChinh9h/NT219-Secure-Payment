'use strict';

const WINDOW_MS  = 5 * 60 * 1000;
const usedNonces = new Set();

function validateNonce(nonce, timestamp) {
  if (!nonce || !timestamp) {
    return { valid: false, reason: 'Missing nonce or timestamp' };
  }

  const drift = Math.abs(Date.now() - Number(timestamp));
  if (drift > WINDOW_MS) {
    return { valid: false, reason: `Request expired: drift ${drift}ms > ${WINDOW_MS}ms` };
  }

  if (usedNonces.has(nonce)) {
    return { valid: false, reason: 'Replay attack detected: nonce already used' };
  }

  usedNonces.add(nonce);

  setTimeout(() => usedNonces.delete(nonce), WINDOW_MS + 1000);

  return { valid: true };
}

function _clearNonces() { usedNonces.clear(); }

module.exports = { validateNonce, _clearNonces };