"use strict";

const orderService = require("./orderService");
const auditService = require("../transactions/auditService");

function canReadOrder(user, order) {
  if (!user || !order) return false;
  if (user.role === "admin") return true;
  if (user.role === "merchant") return order.merchant_user_id === user.userId;
  return order.user_id === user.userId;
}

async function createOrder(req, res) {
  try {
    const { items, shippingAddress } = req.body;
    const order = await orderService.createOrder({
      userId: req.user.userId,
      items,
      shippingAddress,
    });
    await auditService.log({
      eventType: "order_created",
      actorUserId: req.user.userId,
      targetType: "order",
      targetId: order.id,
      metadata: {
        merchantId: order.merchant_id,
        totalAmount: order.total_amount,
        currency: order.currency,
      },
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"] || null,
    });
    return res.status(201).json({ message: "Order created", order });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: status >= 500 ? "Failed to create order" : err.message,
    });
  }
}

async function getOrder(req, res) {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!canReadOrder(req.user, order)) {
      await auditService.log({
        eventType: "ownership_violation",
        actorUserId: req.user.userId,
        targetType: "order",
        targetId: req.params.id,
        metadata: { role: req.user.role },
        ipAddress: req.ip,
      });
      return res.status(403).json({ error: "Forbidden: order is not accessible" });
    }
    return res.status(200).json({ order });
  } catch {
    return res.status(500).json({ error: "Failed to get order" });
  }
}

async function getMyOrders(req, res) {
  try {
    const orders = await orderService.getOrdersByUserId(req.user.userId);
    return res.status(200).json({ orders });
  } catch {
    return res.status(500).json({ error: "Failed to get orders" });
  }
}

async function getMerchantOrders(req, res) {
  try {
    if (!["merchant", "admin"].includes(req.user.role)) {
      await auditService.log({
        eventType: "rbac_violation",
        actorUserId: req.user.userId,
        targetType: "orders",
        metadata: { route: "merchant_orders", role: req.user.role },
        ipAddress: req.ip,
      });
      return res.status(403).json({ error: "Requires role: merchant or admin" });
    }

    const orders = await orderService.getOrdersForMerchantUser({
      userId: req.user.userId,
      role: req.user.role,
    });
    return res.status(200).json({ orders });
  } catch {
    return res.status(500).json({ error: "Failed to get merchant orders" });
  }
}

module.exports = {
  canReadOrder,
  createOrder,
  getOrder,
  getMerchantOrders,
  getMyOrders,
};
