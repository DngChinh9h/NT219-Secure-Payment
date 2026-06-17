"use strict";

const mockVerifyJWT = jest.fn();
jest.mock("../../crypto", () => ({
  verifyJWT: mockVerifyJWT,
}));

const { authenticate } = require("../authMiddleware");
const { requireAdmin } = require("../authzMiddleware");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("admin authorization middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("authenticate rejects missing token with 401", () => {
    const req = { headers: {} };
    const res = mockResponse();

    authenticate(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("customer token is authenticated but rejected by admin guard with 403", () => {
    mockVerifyJWT.mockReturnValueOnce({ userId: "customer-id", role: "customer" });
    const req = { headers: { authorization: "Bearer customer-token" } };
    const res = mockResponse();
    authenticate(req, res, () => requireAdmin(req, res, jest.fn()));

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("admin token passes authentication and admin guard", () => {
    mockVerifyJWT.mockReturnValueOnce({ userId: "admin-id", role: "admin" });
    const req = { headers: { authorization: "Bearer admin-token" } };
    const res = mockResponse();
    const next = jest.fn();
    authenticate(req, res, () => requireAdmin(req, res, next));

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
