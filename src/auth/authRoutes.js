"use strict";
const express = require("express");
const router = express.Router();
const { register, login } = require("./authController");
const { validate, loginSchema, registerSchema } = require("../crypto");
const { loginLimiter, registerLimiter } = require("../gateway/rateLimiter");

router.post("/register", registerLimiter, validate(registerSchema), register);
router.post("/login", loginLimiter, validate(loginSchema), login);

module.exports = router;
