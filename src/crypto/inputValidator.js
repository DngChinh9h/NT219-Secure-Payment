'use strict';
const { z } = require('zod');

const registerSchema = z.object({
  email:    z.string().email('Invalid email format').max(255),
  password: z.string()
    .min(8,  'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Password must contain uppercase')
    .regex(/[0-9]/, 'Password must contain number')
});

const loginSchema = z.object({
  email:    z.string().email().max(255),
  password: z.string().min(1).max(128)
});

const orderSchema = z.object({
  items: z.array(z.object({
    productId:   z.string().uuid('productId must be UUID'),
    productName: z.string().min(1).max(255),
    quantity:    z.number().int().positive().max(100),
    unitPrice:   z.number().int().nonnegative()
  })).min(1, 'Order must have at least 1 item').max(50),

  shippingAddress: z.string().min(5).max(500),
  totalAmount:     z.number().int().positive()
});

const paymentSchema = z.object({
  orderId:     z.string().uuid('orderId must be UUID'),
  stripeToken: z.string()
    .startsWith('pm_', 'Must be Stripe PaymentMethod token'),
  amount:      z.number().int().positive().max(100_000_000)
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error:   'Validation failed',
        details: result.error.flatten().fieldErrors
      });
    }
    req.body = result.data; 
    next();
  };
}

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  orderSchema,
  paymentSchema
};