"use strict";

process.env.HMAC_SECRET = "test-secret-32-chars-minimum!!!x";
const { computeMac, verifyMac, hmacSign, hmacVerify } = require("../hmacHelper");

describe("HMAC message authentication code helper", () => {
  test("computeMac returns SHA-256 hex MAC", () => {
    const mac = computeMac({ amount: 100 });
    expect(typeof mac).toBe("string");
    expect(mac).toHaveLength(64);
    expect(mac).toMatch(/^[a-f0-9]+$/);
  });

  test("computeMac object and JSON string are equivalent for same bytes", () => {
    const obj = { orderId: "abc", amount: 100 };
    expect(computeMac(obj)).toBe(computeMac(JSON.stringify(obj)));
  });

  test("verifyMac returns true for unchanged payload", () => {
    const payload = { orderId: "test-123", amount: 50000, userId: "u1" };
    const mac = computeMac(payload);
    expect(verifyMac(payload, mac)).toBe(true);
  });

  test("payload tamper returns false", () => {
    const mac = computeMac({ amount: 100 });
    expect(verifyMac({ amount: 999 }, mac)).toBe(false);
  });

  test("fake MAC or wrong length returns false", () => {
    expect(verifyMac({ amount: 100 }, "a".repeat(64))).toBe(false);
    expect(verifyMac({ amount: 100 }, "tooshort")).toBe(false);
  });

  test("legacy hmacSign/hmacVerify aliases remain compatible", () => {
    const payload = { ok: true };
    expect(hmacVerify(payload, hmacSign(payload))).toBe(true);
  });
});
