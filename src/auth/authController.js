"use strict";
const userService = require("../users/userService");
const { signJWT } = require("../crypto");

async function register(req, res) {
  try {
    const { email, password } = req.body;

    const existing = await userService.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already exists" });
    }

    const user = await userService.createUser({ email, password });
    const token = signJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
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

    const token = signJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
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
