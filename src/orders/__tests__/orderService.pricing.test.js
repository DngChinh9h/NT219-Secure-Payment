"use strict";

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
jest.mock("../../db", () => ({
  connect: jest.fn(() => Promise.resolve(mockClient)),
  query: jest.fn(),
}));

jest.mock("../../crypto", () => ({
  computeMac: jest.fn(() => "order-mac"),
}));

const db = require("../../db");
const orderService = require("../orderService");

const customerId = "11111111-1111-4111-8111-111111111111";
const merchantId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

describe("orderService server-side pricing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("ignores client unitPrice/totalAmount and stores catalog price", async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: productId,
          merchant_id: merchantId,
          name: "Catalog Item",
          price: 125000,
          currency: "vnd",
          active: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "order_1",
          user_id: customerId,
          merchant_id: merchantId,
          total_amount: 250000,
          currency: "vnd",
          created_at: "2026-06-01T00:00:00.000Z",
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    const order = await orderService.createOrder({
      userId: customerId,
      shippingAddress: "123 Secure Street",
      totalAmount: 1,
      items: [{ productId, quantity: 2, unitPrice: 1 }],
    });

    expect(order.total_amount).toBe(250000);
    expect(order.items[0]).toMatchObject({
      unitPrice: 125000,
      lineTotal: 250000,
      merchantId,
    });
    expect(mockClient.query.mock.calls[3][1]).toEqual([
      "order_1",
      merchantId,
      productId,
      "Catalog Item",
      2,
      125000,
      "vnd",
      250000,
    ]);
  });

  test("rejects inactive or missing product", async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(
      orderService.createOrder({
        userId: customerId,
        shippingAddress: "123 Secure Street",
        items: [{ productId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Product not found or inactive"),
      statusCode: 400,
    });
    expect(mockClient.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  test("rejects a single order spanning multiple merchants", async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: productId,
            merchant_id: merchantId,
            name: "A",
            price: 1000,
            currency: "vnd",
            active: true,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            merchant_id: "55555555-5555-4555-8555-555555555555",
            name: "B",
            price: 1000,
            currency: "vnd",
            active: true,
          },
        ],
      })
      .mockResolvedValueOnce({});

    await expect(
      orderService.createOrder({
        userId: customerId,
        shippingAddress: "123 Secure Street",
        items: [
          { productId, quantity: 1 },
          { productId: "44444444-4444-4444-8444-444444444444", quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({
      message: "Order may contain products from one merchant only",
      statusCode: 400,
    });
  });

  test("merchant order list scopes by merchant user unless admin", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await orderService.getOrdersForMerchantUser({
      userId: "merchant-user",
      role: "merchant",
    });

    expect(db.query.mock.calls[0][0]).toContain("WHERE m.user_id = $1");
    expect(db.query.mock.calls[0][1]).toEqual(["merchant-user"]);
  });
});
