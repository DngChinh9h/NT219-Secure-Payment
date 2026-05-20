"use strict";
const express = require("express");
const router = express.Router();
const { register, login } = require("./authController");
const { validate, loginSchema, registerSchema } = require("../crypto");

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);

module.exports = router;
