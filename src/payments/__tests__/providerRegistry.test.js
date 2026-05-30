"use strict";

jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("stripe", () =>
  jest.fn().mockReturnValue({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  }),
);

const { getProvider, listProviders } = require("../providers/providerRegistry");

describe("providerRegistry", () => {
  test("returns stripe provider by default", () => {
    const provider = getProvider();
    expect(provider).toHaveProperty("createPayment");
    expect(provider).toHaveProperty("retrievePayment");
    expect(provider).toHaveProperty("refundPayment");
  });

  test("returns mock_bank provider", () => {
    const provider = getProvider("mock_bank");
    expect(provider).toHaveProperty("createPayment");
    expect(provider).toHaveProperty("retrievePayment");
    expect(provider).toHaveProperty("refundPayment");
  });

  test("lists supported providers", () => {
    expect(listProviders()).toEqual(["stripe", "mock_bank"]);
  });

  test("throws 400 for unsupported provider", () => {
    expect(() => getProvider("unknown")).toThrow("Unsupported payment provider");

    try {
      getProvider("unknown");
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });
});
