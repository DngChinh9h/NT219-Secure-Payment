"use strict";
const userService = require("../users/userService");
const { getSecurityServiceClient } = require("../security/securityServiceClient");
const auditService = require("../transactions/auditService");

async function register(req, res) {
  try {
    // SỬA DÒNG NÀY: Bóc tách thêm các trường thông tin cá nhân từ req.body
    const { email, password, fullName, address, cccdNumber } = req.body;

    const existing = await userService.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already exists" });
    }

    // SỬA DÒNG NÀY: Truyền đầy đủ các thông tin cá nhân vào hàm createUser
    const user = await userService.createUser({
      email,
      password,
      fullName,
      address,
      cccdNumber,
    });

    const token = await getSecurityServiceClient().signJwt({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await auditService.log({
      eventType: "user_register",
      actorUserId: user.id,
      targetType: "user",
      targetId: user.id,
      metadata: { role: user.role },
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"] || null,
    });

    return res.status(201).json({
      message: "Registered successfully",
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    const user = await userService.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await userService.verifyPassword(
      password,
      user.password_hash,
    );
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = await getSecurityServiceClient().signJwt({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await auditService.log({
      eventType: "user_login",
      actorUserId: user.id,
      targetType: "user",
      targetId: user.id,
      metadata: { role: user.role },
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"] || null,
    });

    return res.status(200).json({
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { register, login };
