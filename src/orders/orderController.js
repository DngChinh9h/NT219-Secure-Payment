"use strict";
const orderService = require("./orderService");
const { requireOwnership } = require("../gateway/authzMiddleware");

async function createOrder(req, res) {
  try {
    const { items, shippingAddress, totalAmount } = req.body;
    const order = await orderService.createOrder({
      userId: req.user.userId,
      items,
      shippingAddress,
      totalAmount,
    });
    return res.status(201).json({ message: "Order created", order });
  } catch (err) {
    console.error("Create order error:", err);
    return res.status(500).json({ error: "Failed to create order" });
  }
}

async function getOrder(req, res) {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.status(200).json({ order });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get order" });
  }
}

async function getMyOrders(req, res) {
  try {
    const orders = await orderService.getOrdersByUserId(req.user.userId);
    return res.status(200).json({ orders });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get orders" });
  }
}

// Hàm lấy userId của order — dùng cho requireOwnership middleware
async function getOrderUserId(req) {
  const order = await orderService.getOrderById(req.params.id);
  return order ? order.user_id : null;
}

module.exports = { createOrder, getOrder, getMyOrders, getOrderUserId };
