"use strict";

const express = require("express");
const { getPublicConfig } = require("./configController");

const router = express.Router();

router.get("/public", getPublicConfig);

module.exports = router;
