"use strict";

const mockFindByEmail = jest.fn();
const mockVerifyPassword = jest.fn();
const mockCreateUser = jest.fn();
jest.mock("../../users/userService", () => ({
  findByEmail: mockFindByEmail,
  verifyPassword: mockVerifyPassword,
  createUser: mockCreateUser,
}));

const mockSignJwt = jest.fn();
jest.mock("../../security/securityServiceClient", () => ({
  getSecurityServiceClient: () => ({ signJwt: mockSignJwt }),
}));

const mockAuditLog = jest.fn();
jest.mock("../../transactions/auditService", () => ({ log: mockAuditLog }));

const { login, register } = require("../authController");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("authController Security Service signing", () => {
  beforeEach(() => { jest.clearAllMocks(); mockSignJwt.mockResolvedValue("security-service-jwt"); });

  test("login sends only safe claims to Security Service instead of signing locally", async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: "admin-id", email: "admin@example.com", role: "admin", password_hash: "bcrypt-hash" });
    mockVerifyPassword.mockResolvedValueOnce(true);
    const res = mockResponse();
    await login({ body: { email: "admin@example.com", password: "AdminPassword123!" }, headers: {}, ip: "127.0.0.1" }, res);
    expect(mockSignJwt).toHaveBeenCalledWith({ userId: "admin-id", email: "admin@example.com", role: "admin" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: "security-service-jwt" }));
  });

  test("register also obtains its JWT from Security Service", async () => {
    mockFindByEmail.mockResolvedValueOnce(null);
    mockCreateUser.mockResolvedValueOnce({ id: "customer-id", email: "customer@example.com", role: "customer" });
    const res = mockResponse();
    await register({ body: { email: "customer@example.com", password: "Password123!", fullName: "Customer", address: "Address", cccdNumber: "1" }, headers: {}, ip: "127.0.0.1" }, res);
    expect(mockSignJwt).toHaveBeenCalledWith({ userId: "customer-id", email: "customer@example.com", role: "customer" });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
