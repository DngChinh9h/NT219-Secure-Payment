# Demo Script - 5 Minutes

## Before Demo

1. Start backend and database locally, or use the AWS B-lite API domain.
2. For local webhook testing, run `stripe listen --forward-to localhost:3000/api/payments/webhook`.
3. Check `GET /health` and `GET /api/health/readiness`.
4. Open the prepared Postman collection or frontend app.

## Main Flow

### Login

Say:

> The system uses JWT ES512 with ECDSA P-521. Only the backend owns the private key; API middleware verifies tokens with the public key.

- Login with email/password and receive a JWT.
- Decode the JWT header and show `"alg": "ES512"`.

### Create Order

Say:

> Order IDs use UUIDs, so users cannot enumerate another user's order IDs.

- Create an order.
- Show the UUID in the response.

### Pay With Stripe

Say:

> Stripe.js runs in the browser. Card data goes to Stripe, while this backend receives payment identifiers and verifies Stripe webhook signatures.

- Pay with Stripe test card `4242 4242 4242 4242`.
- Show the webhook event in backend logs.

### View Transaction Evidence

- Call `GET /api/transactions/mine`.
- Show HMAC/audit evidence for the transaction.

## Security Cases

### Missing JWT

```text
GET /api/orders/mine without Authorization header
Expected: 401 Unauthorized
```

### alg:none JWT

```text
Authorization: Bearer eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJhZG1pbiJ9.
Expected: 401 Unauthorized
```

Say:

> jwtHelper accepts only algorithms: ["ES512"], so alg:none is rejected.

### IDOR

```text
GET /api/orders/{other_user_order_id} with user1 JWT
Expected: 403 Forbidden
```

### SQL Injection

```text
POST /api/auth/login
Body: { "email": "' OR '1'='1' --", "password": "any" }
Expected: 400 Bad Request
```

### Fake Webhook

```text
POST /api/payments/webhook without Stripe-Signature
Expected: 400 Bad Request
```

Say:

> Stripe webhook verification uses the raw request body and Stripe-Signature header. Forged webhook payloads do not update order or transaction state.

## FAQ

Q: Why Stripe.js instead of sending card numbers to the backend?

A: It keeps card data out of the backend and fits the PCI SAQ A style for this student demo.

Q: What does the nonce protect?

A: It blocks replay by rejecting reused nonces or stale timestamps.

Q: What does HMAC protect in transaction logs?

A: It detects tampering if someone changes stored transaction evidence directly.
