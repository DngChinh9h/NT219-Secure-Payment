"use strict";

const mockFindByEmail = jest.fn();
const mockVerifyPassword = jest.fn();
jest.mock("../../users/userService", () => ({
  findByEmail: mockFindByEmail,
  verifyPassword: mockVerifyPassword,
}));

const mockSignJWT = jest.fn(() => "admin-jwt");
jest.mock("../../crypto/jwtHelper", () => ({
  signJWT: mockSignJWT,
}));

const { login } = require("../authController");

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("authController admin login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns admin role and JWT without exposing password hash", async () => {
    mockFindByEmail.mockResolvedValueOnce({
      id: "admin-id",
      email: "admin@example.com",
      role: "admin",
      password_hash: "bcrypt-hash",
    });
    mockVerifyPassword.mockResolvedValueOnce(true);
    const req = {
      body: {
        email: "admin@example.com",
        password: "AdminPassword123!",
      },
    };
    const res = mockResponse();

    await login(req, res);

    expect(mockSignJWT).toHaveBeenCalledWith({
      userId: "admin-id",
      email: "admin@example.com",
      role: "admin",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Login successful",
      token: "admin-jwt",
      user: {
        id: "admin-id",
        email: "admin@example.com",
        role: "admin",
      },
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("bcrypt-hash");
  });
});
