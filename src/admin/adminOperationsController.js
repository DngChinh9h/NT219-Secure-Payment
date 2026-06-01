"use strict";

const adminOperationsService = require("./adminOperationsService");

async function getOrders(req, res) {
  try {
    const items = await adminOperationsService.getOrders();
    return res.status(200).json({ items });
  } catch {
    return res.status(500).json({ error: "Failed to get admin orders" });
  }
}

async function getTransactions(req, res) {
  try {
    const items = await adminOperationsService.getTransactions();
    return res.status(200).json({ items });
  } catch {
    return res.status(500).json({ error: "Failed to get admin transactions" });
  }
}

async function getProviderEvents(req, res) {
  try {
    const result = await adminOperationsService.getProviderEvents();
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ error: "Failed to get provider events" });
  }
}

module.exports = {
  getOrders,
  getProviderEvents,
  getTransactions,
};
