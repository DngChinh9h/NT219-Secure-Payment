"use strict";

const mockAuthenticate = jest.fn();
const mockRequireAdmin = jest.fn();
jest.mock("../../gateway/authMiddleware", () => ({
  authenticate: mockAuthenticate,
}));
jest.mock("../../gateway/authzMiddleware", () => ({
  requireAdmin: mockRequireAdmin,
}));
jest.mock("../securityController", () => ({
  getEvidence: jest.fn(),
  getReceiptSigningKeyStatus: jest.fn(),
  rotateReceiptSigningKey: jest.fn(),
  verifyAuditChain: jest.fn(),
  verifyReceipt: jest.fn(),
}));

const router = require("../securityRoutes");

describe("securityRoutes", () => {
  test("registers admin middleware before all security evidence routes", () => {
    expect(router.stack[0].handle).toBe(mockAuthenticate);
    expect(router.stack[1].handle).toBe(mockRequireAdmin);

    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

    expect(routes).toEqual([
      "get /audit-chain/verify",
      "get /evidence",
      "get /keys/status",
      "post /keys/rotate",
      "post /receipt/verify",
    ]);
  });
});
