"use strict";

const { getReconciliationSummary } = require("../reconciliationService");

describe("reconciliationService", () => {
  test("returns real counts and no mismatch for a consistent paid/refunded flow", async () => {
    const database = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              total_orders: "2",
              paid_orders: "1",
              refunded_orders: "1",
              total_transactions: "2",
              successful_transactions: "1",
              refunded_transactions: "1",
              refund_requests: "1",
              provider_linked_payments: "2",
              provider_linked_refunds: "1",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const summary = await getReconciliationSummary({ database });

    expect(summary).toMatchObject({
      totalOrders: 2,
      paidOrders: 1,
      refundedOrders: 1,
      totalTransactions: 2,
      successfulTransactions: 1,
      refundedTransactions: 1,
      refundRequests: 1,
      providerLinkedPayments: 2,
      providerLinkedRefunds: 1,
      status: "ok",
      mismatchCount: 0,
      mismatches: [],
    });
  });

  test("normalizes detected mismatches for admin evidence", async () => {
    const database = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({
          rows: [
            {
              type: "duplicate_successful_transaction_for_order",
              order_id: "order_1",
              transaction_id: null,
              refund_request_id: null,
              occurrence_count: "2",
            },
          ],
        }),
    };

    const summary = await getReconciliationSummary({ database });

    expect(summary).toMatchObject({
      status: "mismatch_detected",
      mismatchCount: 1,
      mismatches: [
        {
          type: "duplicate_successful_transaction_for_order",
          orderId: "order_1",
          occurrenceCount: 2,
        },
      ],
    });
  });
});
