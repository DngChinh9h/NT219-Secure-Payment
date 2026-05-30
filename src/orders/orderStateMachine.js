"use strict";

const VALID_TRANSITIONS = Object.freeze({
  pending: new Set(["processing", "cancelled", "expired"]),
  processing: new Set(["paid", "payment_failed", "cancelled"]),
  payment_failed: new Set(["pending"]),
  paid: new Set(["refunded"]),
  refunded: new Set(),
  cancelled: new Set(),
  expired: new Set(),
});

function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(VALID_TRANSITIONS[from]?.has(to));
}

function assertTransition(from, to) {
  if (canTransition(from, to)) return true;

  const err = new Error(`Invalid order status transition: ${from} -> ${to}`);
  err.statusCode = 409;
  throw err;
}

module.exports = {
  canTransition,
  assertTransition,
};
