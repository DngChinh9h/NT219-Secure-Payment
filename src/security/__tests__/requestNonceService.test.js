"use strict";

const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
}));

const {
  consumeNonce,
  hashRequest,
} = require("../requestNonceService");

describe("requestNonceService DB-backed anti replay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("first nonce insert succeeds", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "nonce_1", nonce: "n1" }],
    });

    const result = await consumeNonce({
      userId: "11111111-1111-4111-8111-111111111111",
      nonce: "22222222-2222-4222-8222-222222222222",
      requestType: "payment_create",
      timestamp: Date.now(),
      requestBody: { orderId: "order_1" },
    });

    expect(result.valid).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO request_nonces");
  });

  test("duplicate nonce conflict rejects replay even after process restart", async () => {
    mockQuery.mockRejectedValueOnce({ code: "23505" });

    await expect(
      consumeNonce({
        userId: "11111111-1111-4111-8111-111111111111",
        nonce: "22222222-2222-4222-8222-222222222222",
        requestType: "payment_create",
        timestamp: Date.now(),
        requestBody: { orderId: "order_1" },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Replay attack detected"),
      statusCode: 409,
    });
  });

  test("expired timestamp rejects before DB insert", async () => {
    await expect(
      consumeNonce({
        userId: "11111111-1111-4111-8111-111111111111",
        nonce: "22222222-2222-4222-8222-222222222222",
        requestType: "payment_create",
        timestamp: Date.now() - 10 * 60 * 1000,
        requestBody: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("request hash is stable for same request body", () => {
    expect(hashRequest({ a: 1 })).toBe(hashRequest({ a: 1 }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});
