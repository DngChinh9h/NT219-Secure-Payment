# API Contract

All authenticated endpoints use `Authorization: Bearer <jwt>`.

## Auth

### `POST /api/auth/register`
Role: public customer registration.
Body: `email`, `password`, `fullName`, `address`, `cccdNumber`.
Response: JWT and safe user fields.
Security: password hashing, PII AES-256-GCM with a transient data key wrapped by the mandatory Security Service over mTLS, audit `user_register`.

### `POST /api/auth/login`
Role: public.
Body: `email`, `password`.
Response: JWT with `userId`, `email`, `role`.
Security: bcrypt verify; backend sends safe claims to the mandatory Security Service over mTLS for ES512 JWT issuance and keeps only the JWT public key, audit `user_login`.

## Orders

### `POST /api/orders`
Role: `customer`.
Body: `items: [{ productId, quantity }]`, `shippingAddress`.
Response: order with server-computed `total_amount`, `currency`, `merchant_id`, `items`.
Security: ignores client price/total, rejects inactive products, one merchant/currency per order, order item hash, audit `order_created`.

### `GET /api/orders/mine`
Role: `customer`.
Response: orders owned by the authenticated payer.
Security: payer ownership filter.

### `GET /api/orders/merchant`
Role: `merchant` or `admin`.
Response: merchant-owned orders; admin receives all.
Security: merchant isolation by `merchants.user_id`, RBAC violation audit.

### `GET /api/orders/:id`
Role: `customer`, `merchant`, or `admin`.
Response: order details.
Security: customer can read own order, merchant can read own merchant order, admin bypass; ownership violation audit.

## Payments

### `POST /api/payments/create-intent`
Role: `customer`.
Body: `orderId`, `provider`, `paymentToken` or `stripeToken`, `nonce`, `timestamp`, optional `amount`, optional `idempotencyKey`.
Response: provider payment id, payment attempt id, amount/currency from DB.
Security: DB-backed nonce replay protection, payment attempt idempotency, amount cross-check only, provider metadata includes order/payer/merchant.

### `POST /api/payments/webhook`
Role: Stripe.
Body: raw Stripe event.
Security: `express.raw`, Stripe signature verification, webhook event ledger, duplicate event protection, reconciliation of payment id/order/payer/merchant/amount/currency/status before success.

### `POST /api/payments/refund`
Role: `admin`.
Body: `transactionId`, `reason`, `idempotencyKey`, optional `amount`, optional `mockRefundOutcome`.
Response: refund ledger and transaction result.
Security: admin only, success transaction only, no over-refund, no double refund, refund idempotency.

## Transactions And Receipts

### `GET /api/transactions/mine`
Role: `customer`.
Response: payer transactions.
Security: payer ownership filter.

### `GET /api/transactions/merchant`
Role: `merchant` or `admin`.
Response: merchant transactions; admin receives all.
Security: merchant isolation by `merchants.user_id`.

### `GET /api/transactions/:id/receipt`
Role: `customer`, `merchant`, or `admin`.
Response: JWS receipt.
Security: payer/merchant/admin access policy.

### `POST /api/transactions/receipt/verify`
Role: public.
Body: `receipt`.
Response: `{ valid, payload }`.
Security: backend delegates ES512 JWS verification to the mandatory Security Service over mTLS; the service selects a public key by `key_version` and detects receipt tampering.

## Refund Requests

### `POST /api/refund-requests`
Role: `customer`.
Body: `orderId`, `reason`, optional `details`.
Response: pending refund request.
Security: only payer can request refund for paid order with successful transaction.

### `GET /api/refund-requests/mine`
Role: `customer`.
Response: customer refund requests.
Security: payer ownership filter.

### `GET /api/refund-requests/merchant`
Role: `merchant` or `admin`.
Response: merchant refund requests; admin receives all.
Security: merchant isolation.

### `POST /api/admin/refund-requests/:id/approve`
Role: `admin`.
Body: optional `mockRefundOutcome`.
Response: refund request plus refund provider result.
Security: admin-only approval, refund service idempotency key = request id.

### `POST /api/admin/refund-requests/:id/reject`
Role: `admin`.
Body: `adminNote`.
Response: rejected refund request.
Security: admin-only decision audit.

## Security Evidence

### `GET /api/admin/security/audit-chain/verify`
Role: `admin`.
Response: audit chain verification result.
Security: SHA-256 hash chain detects tamper.

### `GET /api/transactions/audit-logs/verify`
Role: `admin`.
Response: audit chain verification result.
Security: same verifier through transaction route.

### `POST /api/admin/security/keys/rotate`
Role: `admin`.
Response: receipt key status.
Security: backend forwards this request over mTLS to Security Service. Only Security Service creates and stores the new ES512 P-521 private key; old public-key versions remain available for receipt verification and backend audits `key_rotation`.

### `POST /api/admin/security/receipt/verify`
Role: `admin`.
Body: `receipt`.
Response: `{ valid, payload }`.
Security: ES512 JWS verification through Security Service and audit. This endpoint never exposes private key material.

## Internal Security Service

These endpoints are not public API endpoints. They are reachable only from the private backend network on HTTPS `9443` with a backend client certificate signed by the internal CA. Security Service rejects missing or untrusted client certificates.

| Method/path | Purpose |
| --- | --- |
| `GET /internal/health` | mTLS health proof. |
| `GET /internal/keys/public` | JWT and receipt public-key metadata only. |
| `POST /internal/sign-jwt` | Signs backend-built `{ userId, email, role }` as ES512 JWT. |
| `POST /internal/sign-receipt` | Signs a canonical payment receipt as ES512 JWS. |
| `POST /internal/verify-receipt` | Verifies JWS with public key selected by version. |
| `POST /internal/wrap-key` | Wraps a 32-byte data key with AES-256-GCM. |
| `POST /internal/unwrap-key` | Authenticates and unwraps an AES-256-GCM envelope. |
| `POST /internal/rotate-receipt-key` | Creates and activates a new ES512 receipt key version. |
