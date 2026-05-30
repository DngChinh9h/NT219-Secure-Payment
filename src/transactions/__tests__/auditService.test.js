"use strict";

const mockQuery = jest.fn();
jest.mock("../../db", () => ({
  query: mockQuery,
}));

const mockHmacSign = jest.fn((payload) =>
  `sig:${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
);
jest.mock("../../crypto", () => ({
  hmacSign: mockHmacSign,
}));

const auditService = require("../auditService");

describe("auditService hash chain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("log stores previous_hash and current_hash with stable app timestamp", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ current_hash: "prev_hash" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await auditService.log({
      eventType: "refund_processed",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      payload: { transactionId: "tx_1" },
    });

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("previous_hash");
    expect(insertCall[0]).toContain("current_hash");
    expect(insertCall[1][6]).toBe("prev_hash");
    expect(insertCall[1][7]).toMatch(/^sig:/);
    expect(insertCall[1][8]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("verifyAuditChain returns valid true for intact chain", async () => {
    const firstCreatedAt = new Date("2026-05-30T00:00:00.000Z");
    const secondCreatedAt = new Date("2026-05-30T00:00:01.000Z");
    const firstPayload = {
      event_type: "payment_succeeded",
      user_id: null,
      ip_address: null,
      user_agent: null,
      payload: { paymentIntentId: "pi_1" },
      created_at: firstCreatedAt,
      previous_hash: "GENESIS",
    };
    const firstHash = mockHmacSign(
      auditService.buildHashPayload({
        eventType: firstPayload.event_type,
        userId: firstPayload.user_id,
        ipAddress: firstPayload.ip_address,
        userAgent: firstPayload.user_agent,
        payload: firstPayload.payload,
        createdAt: firstPayload.created_at,
        previousHash: firstPayload.previous_hash,
      }),
    );
    const secondPayload = {
      event_type: "refund_processed",
      user_id: null,
      ip_address: null,
      user_agent: null,
      payload: { refundId: "re_1" },
      created_at: secondCreatedAt,
      previous_hash: firstHash,
    };
    const secondHash = mockHmacSign(
      auditService.buildHashPayload({
        eventType: secondPayload.event_type,
        userId: secondPayload.user_id,
        ipAddress: secondPayload.ip_address,
        userAgent: secondPayload.user_agent,
        payload: secondPayload.payload,
        createdAt: secondPayload.created_at,
        previousHash: secondPayload.previous_hash,
      }),
    );

    mockQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { id: "audit_1", ...firstPayload, current_hash: firstHash },
        { id: "audit_2", ...secondPayload, current_hash: secondHash },
      ],
    });

    await expect(auditService.verifyAuditChain({ limit: 100 })).resolves.toEqual({
      valid: true,
      checked: 2,
    });
  });

  test("verifyAuditChain reports failedAt when link is broken", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "audit_broken",
          event_type: "refund_processed",
          user_id: null,
          ip_address: null,
          user_agent: null,
          payload: {},
          created_at: new Date("2026-05-30T00:00:00.000Z"),
          previous_hash: "wrong_previous",
          current_hash: "any",
        },
      ],
    });

    await expect(auditService.verifyAuditChain({ limit: 100 })).resolves.toEqual({
      valid: false,
      checked: 1,
      failedAt: "audit_broken",
    });
  });
});
