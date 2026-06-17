"use strict";

const express = require("express");
const { getReadiness } = require("./healthController");

const router = express.Router();

router.get("/readiness", getReadiness);

module.exports = router;
