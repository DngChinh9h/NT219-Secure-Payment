# Manual EC2 Redeploy

This guide assumes the code and tests already pass locally. Keep all secrets, private keys, certificates, and env files outside the repository.

## Target Architecture

- Public EC2 Gateway: Nginx, ZeroSSL certificate, public `api.<domain>`.
- Private EC2 Backend: Node/Express Docker container, listens on `3000`.
- Optional private EC2 Security service: signer/KMS split service if separated later, listens on `4000` or `5000`.
- Private PostgreSQL: EC2 PostgreSQL or private RDS. If RDS is used, do not rely on RDS/ACM/ALB as the main deployment evidence.

Use private DNS where available. Otherwise pin private hostnames in `/etc/hosts` on the gateway/backend:

```bash
10.0.2.10 backend.internal
10.0.3.10 db.internal
10.0.2.20 security.internal
```

## Security Groups

| Source | Destination | Ports | Purpose |
| --- | --- | --- | --- |
| Internet | Gateway | 80, 443 | HTTP challenge, HTTPS API |
| Gateway | Backend | 3000 or 8443 | Reverse proxy to Express |
| Backend | Security | 4000 or 5000 | Optional private signer/KMS service |
| Backend | DB | 5432 | PostgreSQL |
| Backend | Stripe | outbound 443 | Provider API |

Do not open backend, security, or database ports to the Internet.

## ZeroSSL On Gateway

1. Request a certificate for `api.<domain>` in ZeroSSL.
2. Use HTTP file validation through Nginx port `80`, or DNS validation if easier.
3. Place issued files outside the repo:

```bash
sudo mkdir -p /etc/nginx/ssl/api.<domain>
sudo cp certificate.crt ca_bundle.crt /etc/nginx/ssl/api.<domain>/
sudo cp private.key /etc/nginx/ssl/api.<domain>/
sudo chmod 600 /etc/nginx/ssl/api.<domain>/private.key
sudo chmod 644 /etc/nginx/ssl/api.<domain>/certificate.crt /etc/nginx/ssl/api.<domain>/ca_bundle.crt
```

4. Build full chain:

```bash
sudo sh -c 'cat /etc/nginx/ssl/api.<domain>/certificate.crt /etc/nginx/ssl/api.<domain>/ca_bundle.crt > /etc/nginx/ssl/api.<domain>/fullchain.crt'
```

## Nginx Gateway

Create `/etc/nginx/conf.d/api.conf`:

```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
  listen 80;
  server_name api.<domain>;

  location /.well-known/pki-validation/ {
    root /var/www/zerossl;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name api.<domain>;

  ssl_certificate /etc/nginx/ssl/api.<domain>/fullchain.crt;
  ssl_certificate_key /etc/nginx/ssl/api.<domain>/private.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 1m;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "no-referrer" always;

  access_log /var/log/nginx/api-access.log;
  error_log /var/log/nginx/api-error.log warn;

  location /api/ {
    limit_req zone=api_limit burst=20 nodelay;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_pass http://backend.internal:3000;
  }

  location /health {
    proxy_pass http://backend.internal:3000/health;
  }
}
```

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Backend Docker

On the private backend EC2:

```bash
git clone https://github.com/DngChinh9h/NT219-Secure-Payment.git
cd NT219-Secure-Payment
git checkout refactor/secure-transaction-merchant-hardening
docker build -t nt219-secure-payment:latest .
```

Create env file outside the repo, for example `/etc/nt219/backend.env`:

```bash
sudo install -d -m 700 /etc/nt219
sudo nano /etc/nt219/backend.env
sudo chmod 600 /etc/nt219/backend.env
```

The env file must include `DATABASE_URL`, JWT key paths or base64 values, `HMAC_SECRET`, `KMS_MASTER_KEY`, Stripe keys, and CORS origins.

Mount local key material read-only if using files:

```bash
sudo install -d -m 700 /etc/nt219/keys
npm run keys:generate
sudo cp keys/private.pem keys/public.pem /etc/nt219/keys/
sudo chmod 600 /etc/nt219/keys/private.pem
sudo chmod 644 /etc/nt219/keys/public.pem
```

Run migrations and seed:

```bash
docker run --rm --env-file /etc/nt219/backend.env \
  -v /etc/nt219/keys:/run/keys:ro \
  nt219-secure-payment:latest npm run migrate:deploy

docker run --rm --env-file /etc/nt219/backend.env \
  -v /etc/nt219/keys:/run/keys:ro \
  nt219-secure-payment:latest npm run seed
```

Start backend:

```bash
docker rm -f nt219-backend || true
docker run -d --name nt219-backend \
  --restart unless-stopped \
  --env-file /etc/nt219/backend.env \
  -v /etc/nt219/keys:/run/keys:ro \
  -p 3000:3000 \
  --health-cmd='node scripts/smoke-check.js || exit 1' \
  --health-interval=30s \
  --health-timeout=5s \
  --health-retries=3 \
  nt219-secure-payment:latest
```

## Database

For PostgreSQL on private EC2:

```bash
sudo apt-get update
sudo apt-get install -y postgresql
sudo -u postgres createuser --pwprompt nt219_app
sudo -u postgres createdb -O nt219_app nt219_payment
```

Restrict PostgreSQL to private interfaces in `postgresql.conf` and `pg_hba.conf`, then allow only backend private IP/security group to `5432`.

Backup:

```bash
pg_dump "$DATABASE_URL" > nt219-payment-$(date +%F).sql
```

Restore:

```bash
psql "$DATABASE_URL" < nt219-payment-YYYY-MM-DD.sql
```

## Evidence Commands

From the Internet:

```bash
curl -i https://api.<domain>/api/health/readiness
openssl s_client -connect api.<domain>:443 -servername api.<domain> </dev/null
curl -i http://api.<domain>/api/health/readiness
```

Direct backend from the Internet should fail:

```bash
curl -m 5 http://<backend-private-or-public-ip>:3000/api/health/readiness
```

From gateway:

```bash
curl -i http://backend.internal:3000/api/health/readiness
sudo tail -n 50 /var/log/nginx/api-access.log
sudo tail -n 50 /var/log/nginx/api-error.log
```

Security group checks:

```bash
aws ec2 describe-security-groups --group-ids <gateway-sg> <backend-sg> <db-sg>
```

Application evidence from backend:

```bash
npm test
npm run lint
npm run build
npm run secret:scan
node scripts/e2e-hardening.js
node scripts/e2e-reconciliation.js
```

API evidence:

```bash
curl -i https://api.<domain>/api/admin/security/audit-chain/verify -H "Authorization: Bearer <admin-jwt>"
curl -i https://api.<domain>/api/admin/security/keys/status -H "Authorization: Bearer <admin-jwt>"
curl -i https://api.<domain>/api/transactions/receipt/verify -H "Content-Type: application/json" -d '{"receipt":"<jws>"}'
```

Webhook evidence:

```bash
stripe listen --forward-to https://api.<domain>/api/payments/webhook
stripe trigger payment_intent.succeeded
```

Record screenshots or terminal output showing: HTTPS certificate chain, public gateway reachability, private backend/db not Internet reachable, successful health check, JWT-protected admin evidence, receipt verify, webhook duplicate/reconciliation behavior, and audit chain verification.
