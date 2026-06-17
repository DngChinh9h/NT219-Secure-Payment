"use strict";

const failedAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 3;

function checkVelocity(userId) {
  const now = Date.now();

  const attempts = (failedAttempts.get(userId) || [])
    .filter(t => now - t < WINDOW_MS);

  failedAttempts.set(userId, attempts);

  if (attempts.length >= MAX_FAILS) {
    return {
      blocked: true,
      reason: "Too many failed payment attempts. Try again later.",
    };
  }

  return { blocked: false };
}

function recordFailure(userId) {
  const now = Date.now();

  const attempts = (failedAttempts.get(userId) || [])
    .filter(t => now - t < WINDOW_MS);

  attempts.push(now);
  failedAttempts.set(userId, attempts);
}

function resetVelocityForTest(userId) {
  failedAttempts.delete(userId);
}

module.exports = {
  checkVelocity,
  recordFailure,
  resetVelocityForTest,
};
