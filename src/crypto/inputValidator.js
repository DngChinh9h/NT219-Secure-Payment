"use strict";

const { z } = require("zod");

const registerSchema = z.object({
  email: z.string().email("Invalid email format").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long")
    .regex(/[A-Z]/, "Password must contain uppercase")
    .regex(/[0-9]/, "Password must contain number"),
  fullName: z.string().min(1, "Full name is required").max(255),
  address: z.string().min(5, "Address too short").max(500),
  cccdNumber: z.string().min(9, "Identity number too short").max(20),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

// Clients submit catalog references only. Product names, unit prices, and order
// totals are recomputed from products stored on the server.
const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid("productId must be UUID"),
        quantity: z.number().int().positive().max(100),
      }),
    )
    .min(1, "Order must have at least 1 item")
    .max(50),
  shippingAddress: z.string().min(5).max(500),
  // Accepted only for backward-compatible clients; orderService ignores it.
  totalAmount: z.number().int().positive().optional(),
});

const paymentSchema = z
  .object({
    orderId: z.string().uuid("orderId must be UUID"),
    provider: z.enum(["stripe", "mock_bank"]).optional(),
    paymentToken: z.string().optional(),
    stripeToken: z.string().optional(),
    // Optional cross-check. The persisted order amount is always authoritative.
    amount: z.number().int().positive().max(100_000_000).optional(),
    idempotencyKey: z.string().min(8).max(255).optional(),
    nonce: z.string().uuid("nonce must be UUID"),
    timestamp: z.coerce.number().int().positive(),
  })
  .superRefine((data, ctx) => {
    const provider = data.provider || "stripe";

    if (provider === "stripe") {
      const token = data.paymentToken || data.stripeToken;

      if (!token) {
        ctx.addIssue({
          code: "custom",
          path: ["paymentToken"],
          message: "Stripe payment requires stripeToken or paymentToken",
        });
        return;
      }

      if (!token.startsWith("pm_")) {
        ctx.addIssue({
          code: "custom",
          path: data.paymentToken ? ["paymentToken"] : ["stripeToken"],
          message: "Must be Stripe PaymentMethod token",
        });
      }
    }

    if (provider === "mock_bank") {
      if (!["mock_success", "mock_failed", "mock_pending"].includes(data.paymentToken)) {
        ctx.addIssue({
          code: "custom",
          path: ["paymentToken"],
          message: "Invalid MockBank payment token",
        });
      }
    }
  });

const refundPaymentSchema = z.object({
  transactionId: z.string().uuid("transactionId must be UUID"),
  amount: z.number().int().positive().max(100_000_000).optional(),
  reason: z.string().trim().min(1, "reason is required").max(255),
  idempotencyKey: z.string().min(8).max(255),
  mockRefundOutcome: z.enum(["success", "failed", "pending"]).optional(),
});

const refundRequestSchema = z.object({
  orderId: z.string().uuid("orderId must be UUID"),
  reason: z.string().trim().min(1, "reason is required").max(255),
  details: z.string().trim().max(2000).optional(),
});

const refundRequestRejectSchema = z.object({
  adminNote: z.string().trim().min(1, "adminNote is required").max(2000),
});

const refundRequestApproveSchema = z
  .object({
    mockRefundOutcome: z.enum(["success", "failed", "pending"]).optional(),
  })
  .default({});

const refundRequestIdSchema = z.object({
  id: z.string().uuid("refund request id must be UUID"),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    return next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
    }
    req.params = result.data;
    return next();
  };
}

module.exports = {
  validate,
  validateParams,
  registerSchema,
  loginSchema,
  orderSchema,
  paymentSchema,
  refundPaymentSchema,
  refundRequestSchema,
  refundRequestRejectSchema,
  refundRequestApproveSchema,
  refundRequestIdSchema,
};
