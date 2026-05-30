"use strict";

const {
  canTransition,
  assertTransition,
} = require("../orderStateMachine");

describe("orderStateMachine", () => {
  test.each([
    ["pending", "processing"],
    ["pending", "cancelled"],
    ["pending", "expired"],
    ["processing", "paid"],
    ["processing", "payment_failed"],
    ["processing", "cancelled"],
    ["payment_failed", "pending"],
    ["paid", "refunded"],
  ])("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(assertTransition(from, to)).toBe(true);
  });

  test.each([
    ["paid", "pending"],
    ["paid", "processing"],
    ["refunded", "paid"],
    ["cancelled", "paid"],
    ["expired", "paid"],
  ])("rejects %s -> %s with statusCode 409", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(
      `Invalid order status transition: ${from} -> ${to}`,
    );

    try {
      assertTransition(from, to);
    } catch (err) {
      expect(err.statusCode).toBe(409);
    }
  });
});
