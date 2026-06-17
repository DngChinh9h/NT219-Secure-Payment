"use strict";

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(async () => ({
  query: mockClientQuery,
  release: mockRelease,
}));
jest.mock("../../db", () => ({
  connect: mockConnect,
  query: mockQuery,
}));

const mockHmacSign = jest.fn((payload) =>
  `sig:${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
);
jest.mock("../../crypto", () => ({
  hmacSign: mockHmacSign,
}));

const auditService = require("../auditService");

function makeShaRow({
  id,
  eventType,
  actorUserId = null,
  targetType = null,
  targetId = null,
  metadata = {},
  createdAt,
  prevHash,
}) {
  return {
    id,
    event_type: eventType,
    actor_user_id: actorUserId,
    target_type: targetType,
    target_id: targetId,
    metadata,
    created_at: createdAt,
    prev_hash: prevHash,
    current_hash: auditService.calculateCurrentHash({
      prevHash,
      id,
      eventType,
      actorUserId,
      targetType,
      targetId,
      metadata,
      createdAt,
    }),
    chain_version: auditService.CHAIN_VERSION,
  };
}

describe("auditService SHA-256 hash chain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("log stores canonical SHA-256 evidence fields inside a DB transaction", async () => {
    mockClientQuery
      .mockResolvedValueOnce()
      .mockResolvedValueOnce()
      .mockResolvedValueOnce({ rows: [{ current_hash: "prev_hash" }] })
      .mockResolvedValueOnce()
      .mockResolvedValueOnce();

    const log = await auditService.log({
      eventType: "refund_approved",
      actorUserId: "660e8400-e29b-41d4-a716-446655440000",
      targetType: "refund_request",
      targetId: "request_1",
      metadata: { transactionId: "tx_1" },
    });

    const insertCall = mockClientQuery.mock.calls[3];
    expect(mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_xact_lock($1)",
      [auditService.AUDIT_LOCK_ID],
    );
    expect(insertCall[0]).toContain("actor_user_id");
    expect(insertCall[0]).toContain("target_type");
    expect(insertCall[0]).toContain("metadata");
    expect(insertCall[0]).toContain("prev_hash");
    expect(log).toMatchObject({
      event_type: "refund_approved",
      target_type: "refund_request",
      target_id: "request_1",
      prev_hash: "prev_hash",
      chain_version: "sha256_v1",
    });
    expect(log.current_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockClientQuery).toHaveBeenNthCalledWith(5, "COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("verifyAuditChain returns valid true for an intact chain", async () => {
    const first = makeShaRow({
      id: "audit_1",
      eventType: "payment_succeeded",
      targetType: "transaction",
      targetId: "tx_1",
      metadata: { providerPaymentId: "pi_1" },
      createdAt: new Date("2026-05-30T00:00:00.000Z"),
      prevHash: "GENESIS",
    });
    const second = makeShaRow({
      id: "audit_2",
      eventType: "receipt_issued",
      targetType: "transaction",
      targetId: "tx_1",
      metadata: {},
      createdAt: new Date("2026-05-30T00:00:01.000Z"),
      prevHash: first.current_hash,
    });
    mockQuery.mockResolvedValueOnce({ rows: [first, second] });

    await expect(auditService.verifyAuditChain({ limit: 100 })).resolves.toEqual({
      valid: true,
      checked: 2,
      brokenAt: null,
    });
  });

  test("tampering with audit metadata makes verification fail", async () => {
    const row = makeShaRow({
      id: "audit_broken",
      eventType: "provider_refund_succeeded",
      targetType: "refund_request",
      targetId: "request_1",
      metadata: { refundId: "re_1" },
      createdAt: new Date("2026-05-30T00:00:00.000Z"),
      prevHash: "GENESIS",
    });
    row.metadata = { refundId: "re_tampered" };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    await expect(auditService.verifyAuditChain({ limit: 100 })).resolves.toEqual({
      valid: false,
      checked: 1,
      brokenAt: "audit_broken",
    });
  });
});
