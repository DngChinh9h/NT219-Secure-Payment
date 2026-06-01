# Production-Like Deployment

## Render Backend

Create a Render Web Service from this repository and attach a PostgreSQL
database. Use Node.js and set:

```text
Build Command: npm ci
Start Command: npm run start:prod
Health Check Path: /api/health/readiness
```

`npm run start:prod` runs the deploy-safe PostgreSQL migration before starting
Express. To run the migration separately:

```bash
npm run migrate:deploy
```

### Required Render Environment Variables

```text
NODE_ENV=production
PUBLIC_APP_ENV=production
DATABASE_URL=<Render PostgreSQL connection string>
CORS_ORIGINS=https://your-frontend.vercel.app
JWT_PRIVATE_KEY_PATH=/etc/secrets/private.pem
JWT_PUBLIC_KEY_PATH=/etc/secrets/public.pem
HMAC_SECRET=<strong random value>
KMS_MASTER_KEY=<64 hex characters>
STRIPE_SECRET_KEY=<Stripe secret key>
STRIPE_PUBLISHABLE_KEY=<Stripe publishable key>
STRIPE_WEBHOOK_SECRET=<Stripe webhook signing secret>
```

Store the RSA PEM files as Render Secret Files at the paths configured above.
Do not expose secret keys through frontend variables.

Optional backend variables:

```text
DB_SSL=true
READINESS_DB_TIMEOUT_MS=3000
FRONTEND_ORIGIN=<legacy single frontend origin>
TRUST_PROXY_HOPS=1
RATE_LIMIT_GENERAL_MAX=300
RATE_LIMIT_AUTH_MAX=30
RATE_LIMIT_PAYMENT_MAX=60
RATE_LIMIT_REFUND_REQUEST_MAX=30
RATE_LIMIT_ADMIN_REFUND_MAX=60
RISK_FAILED_PAYMENT_THRESHOLD=3
RISK_REFUND_REQUEST_THRESHOLD=3
RISK_HIGH_AMOUNT_THRESHOLD=10000000
```

### Admin Seed

Run `npm run seed:admin` manually when an admin account is needed. These
variables are only required for that command:

```text
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD=<strong admin password>
ADMIN_FULL_NAME=Operations Admin
ADMIN_ADDRESS=Admin Office
ADMIN_CCCD_NUMBER=000000000001
ADMIN_RESET_PASSWORD=false
```

## Vercel Frontend

Deploy the separate frontend repository to Vercel. Configure:

```text
VITE_API_BASE_URL=https://your-backend.onrender.com
```

The frontend can read the Stripe publishable key from:

```text
GET https://your-backend.onrender.com/api/config/public
```

Add the exact Vercel origin to backend `CORS_ORIGINS`. Multiple origins are
comma-separated. Never use `*` in production. To allow local Vite during a
production-like test, include `http://localhost:5173` explicitly.

## Stripe Webhook

Create a Stripe webhook endpoint:

```text
https://your-backend.onrender.com/api/payments/webhook
```

Subscribe to:

```text
payment_intent.succeeded
payment_intent.payment_failed
```

Set its signing secret as `STRIPE_WEBHOOK_SECRET`. The webhook route keeps the
raw request body required by Stripe signature verification.

## Deployment Verification

Check liveness and readiness:

```text
GET /health
GET /api/health/readiness
GET /api/config/public
```

Admin security dashboards can read:

```text
GET /api/admin/security/reconciliation
GET /api/admin/security/risk-evidence
```

Run the final black-box suite:

```powershell
$env:API_BASE_URL="https://your-backend.onrender.com"
$env:E2E_ADMIN_EMAIL="admin@example.com"
$env:E2E_ADMIN_PASSWORD="<admin-password>"
npm run e2e:production
```

The suite runs refund, security evidence, signing key rotation, hardening, and
reconciliation checks. It creates test records and rotates the active receipt
signing key.
