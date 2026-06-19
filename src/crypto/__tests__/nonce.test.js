"use strict";

const { validateNonce, _clearNonces } = require("../nonceValidator");

describe("nonceValidator timestamp helper", () => {
  beforeEach(() => _clearNonces());

  test("fresh nonce and timestamp is format-valid", () => {
    expect(validateNonce("unique-nonce-001", Date.now())).toEqual({ valid: true });
  });

  test("duplicate replay state is not stored in memory", () => {
    expect(validateNonce("same-nonce", Date.now()).valid).toBe(true);
    expect(validateNonce("same-nonce", Date.now()).valid).toBe(true);
  });

  test("old timestamp is rejected", () => {
    const result = validateNonce("nonce-old", Date.now() - 6 * 60 * 1000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  test("missing nonce or timestamp is rejected", () => {
    expect(validateNonce(null, Date.now()).valid).toBe(false);
    expect(validateNonce("nonce-123", null).valid).toBe(false);
  });
});
