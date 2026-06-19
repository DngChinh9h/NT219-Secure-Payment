# Manual EC2 Redeploy With Mandatory Security Service

Run the test and build commands in the final section before deploying. The backend is not deployable without the private Security Service: it never receives a JWT private key, receipt private key, or `KMS_MASTER_KEY`.

## Target Architecture

- Public Gateway EC2: Nginx and ZeroSSL certificate for `api.<domain>`.
- Private Backend EC2: Node/Express Docker container on `3000`.
- Private Security EC2: `security-service` Docker container on `9443`, HTTPS with mandatory mTLS.
- Private PostgreSQL: PostgreSQL EC2 or private RDS on `5432`.

Use private DNS names such as `backend.internal`, `security.internal`, and `db.internal`. Do not use a public address or `localhost` between backend and Security Service.

| Source | Destination | Ports | Rule |
| --- | --- | --- | --- |
| Internet | Gateway | 80, 443 | ZeroSSL HTTP challenge and public HTTPS API |
| Gateway | Backend | 3000 | Gateway reverse proxy only |
| Backend | Security | 9443 | Required HTTPS/mTLS signer and KMS calls |
| Backend | Database | 5432 | Application PostgreSQL user only |
| Backend | Stripe | outbound 443 | Stripe API and webhook-related provider calls |

Do not allow Internet ingress to backend, Security Service, or PostgreSQL.

## Gateway And ZeroSSL

Request the `api.<domain>` certificate in ZeroSSL with HTTP or DNS validation. Keep certificate material outside the repository:

```bash
sudo install -d -m 700 /etc/nginx/ssl/api.<domain>
sudo cp certificate.crt ca_bundle.crt private.key /etc/nginx/ssl/api.<domain>/
sudo sh -c 'cat /etc/nginx/ssl/api.<domain>/certificate.crt /etc/nginx/ssl/api.<domain>/ca_bundle.crt > /etc/nginx/ssl/api.<domain>/fullchain.crt'
sudo chmod 600 /etc/nginx/ssl/api.<domain>/private.key
sudo chmod 644 /etc/nginx/ssl/api.<domain>/certificate.crt /etc/nginx/ssl/api.<domain>/ca_bundle.crt /etc/nginx/ssl/api.<domain>/fullchain.crt
```

Use this Nginx configuration:

```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
  listen 80;
  server_name api.<domain>;
  location /.well-known/pki-validation/ { root /var/www/zerossl; }
  location / { return 301 https://$host$request_uri; }
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
  location /health { proxy_pass http://backend.internal:3000/health; }
}
```

Run `sudo nginx -t && sudo systemctl reload nginx`.

## Internal Key And Certificate Material

On a secured deployment workstation or the Security EC2, generate initial development-like internal material only as a bootstrap step:

```bash
npm run security:dev-certs -- /etc/nt219/security-material
```

For production, replace this material with certificates signed by the organization internal CA and create ES512 P-521 signing keys in the same protected location. Never commit, copy to the backend source tree, or mount private key directories into the backend container.

Set ownership so only the Security Service runtime account can read `/etc/nt219/security-material/keys/security` and `/etc/nt219/security-material/certs/security`. Backend receives only these read-only mounts:

- backend client certificate and key;
- internal CA certificate;
- JWT public key.

## Security Service EC2

Build on the private Security host:

```bash
git clone https://github.com/DngChinh9h/NT219-Secure-Payment.git
cd NT219-Secure-Payment
git checkout refactor/secure-transaction-merchant-hardening
docker build -t nt219-security-service:latest ./security-service
```

Create `/etc/nt219/security-service.env` with mode `600` from `security-service/.env.example`. It must contain `KMS_MASTER_KEY`, server TLS paths, the internal CA path, JWT private/public paths, and receipt private/public directories. The Security Service listens on `9443` with `requestCert=true` and `rejectUnauthorized=true`.

```bash
docker run -d --name nt219-security --restart unless-stopped \
  --env-file /etc/nt219/security-service.env \
  -v /etc/nt219/security-material/certs/ca:/run/certs/ca:ro \
  -v /etc/nt219/security-material/certs/security:/run/certs/security:ro \
  -v /etc/nt219/security-material/keys:/run/keys:rw \
  nt219-security-service:latest
```

The Security Service has only internal endpoints: `GET /internal/health`, `GET /internal/keys/public`, `POST /internal/sign-jwt`, `POST /internal/sign-receipt`, `POST /internal/verify-receipt`, `POST /internal/wrap-key`, `POST /internal/unwrap-key`, and `POST /internal/rotate-receipt-key`.

## Backend EC2

Build the backend image:

```bash
docker build -t nt219-secure-payment:latest .
```

Create `/etc/nt219/backend.env` with mode `600` from `.env.example`. Required Security Service values are:

```text
SECURITY_SERVICE_BASE_URL=https://security.internal:9443
SECURITY_CLIENT_CERT_PATH=/run/certs/backend/backend-client.crt
SECURITY_CLIENT_KEY_PATH=/run/certs/backend/backend-client.key
SECURITY_CA_CERT_PATH=/run/certs/ca/internal-ca.crt
JWT_PUBLIC_KEY_PATH=/run/public/jwt-public.pem
```

Do not place `JWT_PRIVATE_KEY_PATH`, `JWT_PRIVATE_KEY`, `JWT_PRIVATE_KEY_B64`, `KMS_MASTER_KEY`, or receipt private-key values in this file. Backend startup rejects those settings in production.

Run database migration and seed with the same backend env and public/client-cert mounts:

```bash
docker run --rm --env-file /etc/nt219/backend.env \
  -v /etc/nt219/security-material/certs/ca:/run/certs/ca:ro \
  -v /etc/nt219/security-material/certs/backend:/run/certs/backend:ro \
  -v /etc/nt219/security-material/keys/public:/run/public:ro \
  nt219-secure-payment:latest npm run migrate:deploy

docker run --rm --env-file /etc/nt219/backend.env \
  -v /etc/nt219/security-material/certs/ca:/run/certs/ca:ro \
  -v /etc/nt219/security-material/certs/backend:/run/certs/backend:ro \
  -v /etc/nt219/security-material/keys/public:/run/public:ro \
  nt219-secure-payment:latest npm run seed
```

Start the backend:

```bash
docker run -d --name nt219-backend --restart unless-stopped \
  --env-file /etc/nt219/backend.env \
  -v /etc/nt219/security-material/certs/ca:/run/certs/ca:ro \
  -v /etc/nt219/security-material/certs/backend:/run/certs/backend:ro \
  -v /etc/nt219/security-material/keys/public:/run/public:ro \
  -p 3000:3000 \
  nt219-secure-payment:latest
```

## Database

Keep PostgreSQL private-only and create a dedicated application role. Restrict `pg_hba.conf` and security groups to the backend private address/security group. Example backup and restore:

```bash
pg_dump "$DATABASE_URL" > nt219-payment-$(date +%F).sql
psql "$DATABASE_URL" < nt219-payment-YYYY-MM-DD.sql
```

The migration removes historical private receipt-key columns. Receipt key files and the `active-version` metadata are owned by Security Service; the backend does not query private-key columns.

## Evidence Commands

```bash
curl -i https://api.<domain>/api/health/readiness
openssl s_client -connect api.<domain>:443 -servername api.<domain> </dev/null
curl -m 5 http://<backend-public-ip>:3000/api/health/readiness
aws ec2 describe-security-groups --group-ids <gateway-sg> <backend-sg> <security-sg> <db-sg>
```

From the private backend host, test the Security Service only with the backend client certificate:

```bash
curl --cacert /etc/nt219/security-material/certs/ca/internal-ca.crt \
  --cert /etc/nt219/security-material/certs/backend/backend-client.crt \
  --key /etc/nt219/security-material/certs/backend/backend-client.key \
  https://security.internal:9443/internal/health
```

No-cert and wrong-CA calls must fail at TLS handshake. Record the output of `npm test -- --runInBand`, `npm run security:test`, receipt verify, Stripe webhook verification, and `GET /api/admin/security/audit-chain/verify` as deployment evidence.
