"use strict";

const mockBankProvider = require("../providers/mockBankProvider");

describe("mockBankProvider", () => {
  const order = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    user_id: "660e8400-e29b-41d4-a716-446655440000",
    total_amount: 50000,
  };

  test.each([
    ["mock_success", "succeeded"],
    ["mock_failed", "failed"],
    ["mock_pending", "processing"],
  ])("maps %s to %s", async (paymentMethodToken, expectedStatus) => {
    const result = await mockBankProvider.createPayment({
      order,
      paymentMethodToken,
    });

    expect(result).toMatchObject({
      provider: "mock_bank",
      status: expectedStatus,
      clientSecret: null,
    });
    expect(result.providerPaymentId).toMatch(/^mock_pi_[0-9a-f-]+$/);
    expect(result.raw).toMatchObject({
      orderId: order.id,
      userId: order.user_id,
      amount: Number(order.total_amount),
      currency: "vnd",
      status: expectedStatus,
      token: paymentMethodToken,
    });
  });

  test("rejects invalid token", async () => {
    await expect(
      mockBankProvider.createPayment({
        order,
        paymentMethodToken: "mock_unknown",
      }),
    ).rejects.toMatchObject({
      message: "Invalid MockBank payment token",
      statusCode: 400,
    });
  });

  test("refundPayment returns a mock refund id", async () => {
    const result = await mockBankProvider.refundPayment({
      providerPaymentId: "mock_pi_123",
      amount: 50000,
      reason: "requested_by_customer",
    });

    expect(result).toMatchObject({
      provider: "mock_bank",
      status: "succeeded",
    });
    expect(result.refundId).toMatch(/^mock_re_[0-9a-f-]+$/);
    expect(result.raw).toMatchObject({
      providerPaymentId: "mock_pi_123",
      amount: 50000,
      reason: "requested_by_customer",
    });
  });
});
