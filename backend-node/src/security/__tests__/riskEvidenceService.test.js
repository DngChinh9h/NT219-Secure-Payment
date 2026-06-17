"use strict";

const { getRiskEvidence } = require("../riskEvidenceService");

describe("riskEvidenceService", () => {
  test("returns explainable observed duplicate, replay, amount, and provider signals", async () => {
    const database = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [{ user_id: "user_1", email: "user@example.com", occurrence_count: "4" }],
        })
        .mockResolvedValueOnce({
          rows: [{ user_id: "user_1", email: "user@example.com", occurrence_count: "3" }],
        })
        .mockResolvedValueOnce({ rows: [{ occurrence_count: "2" }] })
        .mockResolvedValueOnce({ rows: [{ occurrence_count: "1" }] })
        .mockResolvedValueOnce({ rows: [{ occurrence_count: "1" }] })
        .mockResolvedValueOnce({
          rows: [{ order_id: "order_1", user_id: "user_1", total_amount: "15000000", status: "paid" }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              refund_request_id: "refund_1",
              order_id: "order_1",
              user_id: "user_1",
              provider: "mock_bank",
              provider_status: "failed",
              provider_error_present: true,
            },
          ],
        }),
    };

    const evidence = await getRiskEvidence({ database });

    expect(evidence).toMatchObject({
      status: "review",
      triggeredRules: 7,
      rules: {
        repeatedFailedPayments: {
          enabled: true,
          flaggedUsers: [{ userId: "user_1", occurrenceCount: 4 }],
        },
        manyRefundRequests: {
          enabled: true,
          flaggedUsers: [{ userId: "user_1", occurrenceCount: 3 }],
        },
        duplicatePaymentAttemptsBlocked: { enabled: true, observedCount: 2 },
        duplicateRefundAttemptsBlocked: { enabled: true, observedCount: 1 },
        replayAttemptsBlocked: { enabled: true, observedCount: 1 },
        highAmountOrders: { enabled: true, observedCount: 1 },
        suspiciousProviderFailures: { enabled: true, observedCount: 1 },
      },
    });
    expect(JSON.stringify(evidence)).not.toContain("provider_error");
  });

  test("returns enabled rules with clear status when no signals exist", async () => {
    const database = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ occurrence_count: "0" }] })
        .mockResolvedValueOnce({ rows: [{ occurrence_count: "0" }] })
        .mockResolvedValueOnce({ rows: [{ occurrence_count: "0" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const evidence = await getRiskEvidence({ database });

    expect(evidence.status).toBe("clear");
    expect(evidence.triggeredRules).toBe(0);
    expect(evidence.rules.duplicateRefundAttemptsBlocked).toEqual({
      enabled: true,
      observedCount: 0,
    });
  });
});
