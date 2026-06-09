# AWS B-lite Evidence Checklist

Capture these screenshots or terminal outputs for the report.

## Network

- VPC `10.20.0.0/16`.
- Public subnets with route `0.0.0.0/0 -> Internet Gateway`.
- Private app subnet with route `0.0.0.0/0 -> NAT Gateway`.
- Private data subnets without public Internet route.

## Security Groups

- `sg-alb` allows public 80/443 only.
- `sg-backend` allows 3000 only from `sg-alb`.
- `sg-rds` allows 5432 only from `sg-backend`.

## Private Backend

- EC2 has private IPv4 only.
- No inbound SSH rule.
- Session Manager connection works.
- `docker ps` shows `nt219-backend`.

## Private Database

- RDS PostgreSQL has `Publicly accessible: No`.
- RDS encryption is enabled.
- RDS SG is `sg-rds`.

## Public Entrypoint

- ALB is internet-facing.
- HTTPS listener uses ACM certificate.
- Target group health check path is `/health`.
- Target is healthy.

## Secrets and Keys

- AWS Secrets Manager secret names, without values.
- ES512 key files exist on EC2 with restricted permissions.
- `openssl ec -in /opt/nt219/keys/jwt_private.pem -text -noout` shows `secp521r1` and `P-521`.

## Logs

- CloudWatch log group `/nt219/backend`.
- Startup logs show service started, port, `NODE_ENV`, health path.
- Stripe webhook logs show verified/processed events.

## Crypto Evidence

- JWT header shows `"alg": "ES512"`.
- Receipt/security evidence endpoint shows receipt signing algorithm `ES512`.
- No runtime signing code references `RS256`.

## Stripe

- Stripe test-mode webhook endpoint is `https://api.<domain>/api/payments/webhook`.
- Stripe dashboard shows recent delivery with HTTP 200.

## App

- Vercel frontend runs over HTTPS.
- `VITE_API_BASE_URL` points to `https://api.<domain>`.
- Login, order creation, payment, webhook, and admin RBAC flows work through the ALB domain.
