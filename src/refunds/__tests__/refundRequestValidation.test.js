"use strict";

const {
  refundRequestSchema,
  refundRequestApproveSchema,
  refundRequestRejectSchema,
  refundRequestIdSchema,
} = require("../../crypto/inputValidator");

describe("refund request validation", () => {
  test("accepts valid customer refund request", () => {
    expect(
      refundRequestSchema.safeParse({
        orderId: "550e8400-e29b-41d4-a716-446655440000",
        reason: "requested_by_customer",
        details: "Product was duplicated",
      }).success,
    ).toBe(true);
  });

  test("rejects invalid order UUID", () => {
    expect(
      refundRequestSchema.safeParse({
        orderId: "not-a-uuid",
        reason: "requested_by_customer",
      }).success,
    ).toBe(false);
  });

  test("rejects admin rejection without note", () => {
    expect(refundRequestRejectSchema.safeParse({}).success).toBe(false);
    expect(refundRequestRejectSchema.safeParse({ adminNote: " " }).success).toBe(
      false,
    );
  });

  test("rejects invalid refund request id", () => {
    expect(refundRequestIdSchema.safeParse({ id: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  test("accepts empty approve body and supported MockBank outcomes", () => {
    expect(refundRequestApproveSchema.safeParse(undefined).success).toBe(true);
    expect(
      refundRequestApproveSchema.safeParse({ mockRefundOutcome: "pending" })
        .success,
    ).toBe(true);
  });

  test("rejects unsupported MockBank approve outcome", () => {
    expect(
      refundRequestApproveSchema.safeParse({ mockRefundOutcome: "unknown" })
        .success,
    ).toBe(false);
  });
});
