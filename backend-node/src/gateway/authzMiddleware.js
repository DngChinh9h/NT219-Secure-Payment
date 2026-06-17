"use strict";

/**
 * Middleware: kiểm tra ownership
 * Dùng cho các route cần resource thuộc về user đang đăng nhập
 *
 * Cách dùng:
 *   router.get('/:id', authenticate, requireOwnership(getOrderUserId), controller.getOrder)
 *
 * @param {Function} getUserIdFn - async (req) => userId của resource
 */
function requireOwnership(getUserIdFn) {
  return async (req, res, next) => {
    try {
      const resourceUserId = await getUserIdFn(req);
      if (!resourceUserId) {
        return res.status(404).json({ error: "Resource not found" });
      }
      // Admin bypass
      if (req.user.role === "admin") return next();
      // Ownership check — fix #4 IDOR
      if (resourceUserId !== req.user.userId) {
        return res
          .status(403)
          .json({ error: "Forbidden: resource belongs to another user" });
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: "Authorization check failed" });
    }
  };
}

/**
 * Middleware: chỉ cho phép role cụ thể
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

const requireAdmin = requireRole("admin");

module.exports = { requireOwnership, requireRole, requireAdmin };
