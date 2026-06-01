"use strict";

const healthService = require("./healthService");

function getLiveness(req, res) {
  return res.status(200).json({
    status: "ok",
    time: new Date(),
  });
}

async function getReadiness(req, res) {
  const readiness = await healthService.checkReadiness();
  return res.status(readiness.status === "ready" ? 200 : 503).json(readiness);
}

module.exports = {
  getLiveness,
  getReadiness,
};
