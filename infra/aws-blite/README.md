# AWS B-lite Deployment

Target architecture:

- Frontend: Vercel.
- Public entrypoint: AWS Application Load Balancer with HTTPS.
- Backend: Docker on one EC2 instance in a private app subnet.
- Database: private RDS PostgreSQL.
- Outbound Internet: one NAT Gateway for Stripe API calls.
- Secrets: AWS Secrets Manager/KMS, materialized to `/opt/nt219/backend.env` and `/opt/nt219/keys/*` for the demo.
- Logs: CloudWatch Agent collects `/var/log/nt219-backend/docker.log`.

## 1. Region and Network

Use `ap-southeast-1`.

VPC CIDR:

```text
10.20.0.0/16
```

Subnets:

```text
public-a       10.20.1.0/24   ap-southeast-1a
public-b       10.20.2.0/24   ap-southeast-1b
private-app-a  10.20.11.0/24  ap-southeast-1a
private-data-a 10.20.21.0/24  ap-southeast-1a
private-data-b 10.20.22.0/24  ap-southeast-1b
```

Route tables:

```text
public subnets: 0.0.0.0/0 -> Internet Gateway
private-app-a: 0.0.0.0/0 -> NAT Gateway in public-a
private-data-a/private-data-b: no Internet route
```

## 2. Security Groups

`sg-alb`:

```text
Inbound  80/tcp  0.0.0.0/0
Inbound  443/tcp 0.0.0.0/0
Outbound 3000/tcp sg-backend
```

`sg-backend`:

```text
Inbound  3000/tcp sg-alb
Outbound 5432/tcp sg-rds
Outbound 443/tcp  0.0.0.0/0
```

`sg-rds`:

```text
Inbound 5432/tcp sg-backend
```

Do not open SSH. Use AWS Systems Manager Session Manager.

## 3. RDS PostgreSQL

Create a DB subnet group using `private-data-a` and `private-data-b`.

Recommended demo settings:

```text
Engine: PostgreSQL
Instance: db.t4g.micro or db.t3.micro
Public access: No
Storage encrypted: Yes
Security group: sg-rds
```

Set backend env:

```text
DATABASE_URL=postgresql://<db_user>:<db_password>@<rds-endpoint>:5432/<db_name>
DB_SSL=true
```

Run migration manually after reviewing the target:

```bash
docker exec nt219-backend npm run migrate:deploy
```

## 4. EC2 Backend

Launch Ubuntu in `private-app-a`.

Attach an IAM role with:

```text
AmazonSSMManagedInstanceCore
CloudWatchAgentServerPolicy
SecretsManagerReadWrite or a narrower read-only policy for payment/* secrets
```

Install Docker, Git, and CloudWatch Agent. Clone this repo:

```bash
sudo mkdir -p /opt/nt219
sudo chown ubuntu:ubuntu /opt/nt219
cd /opt/nt219
git clone https://github.com/<owner>/NT219-Secure-Payment.git
```

Create `/opt/nt219/backend.env` from `backend.env.example`. Do not commit it.

Create ES512 keys:

```bash
mkdir -p /opt/nt219/keys
openssl ecparam -name secp521r1 -genkey -noout -out /opt/nt219/keys/jwt_private.pem
openssl ec -in /opt/nt219/keys/jwt_private.pem -pubout -out /opt/nt219/keys/jwt_public.pem
chmod 700 /opt/nt219/keys
chmod 600 /opt/nt219/keys/jwt_private.pem
chmod 644 /opt/nt219/keys/jwt_public.pem
```

Deploy:

```bash
cd /opt/nt219/NT219-Secure-Payment
chmod +x infra/aws-blite/deploy-backend-ec2.sh
infra/aws-blite/deploy-backend-ec2.sh
```

## 5. CloudWatch Logs

Copy the config:

```bash
sudo cp infra/aws-blite/cloudwatch-agent-config.json /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
  -s
```

Expected log group:

```text
/nt219/backend
```

## 6. ALB HTTPS

Create an internet-facing ALB in `public-a` and `public-b`.

Target group:

```text
Target type: Instance
Protocol: HTTP
Port: 3000
Health check path: /health
Success code: 200
Target: private EC2 instance
```

Listeners:

```text
80  -> redirect to HTTPS 443
443 -> ACM certificate -> target group
```

DNS:

```text
api.example.com CNAME -> ALB DNS name
```

## 7. Vercel Frontend

Keep frontend on Vercel.

Set:

```text
VITE_API_BASE_URL=https://api.example.com
```

Redeploy after changing the env var.

Backend CORS:

```text
CORS_ORIGINS=https://<vercel-frontend-domain>
```

## 8. Stripe Webhook

Create a Stripe test-mode webhook endpoint:

```text
https://api.example.com/api/payments/webhook
```

Events:

```text
payment_intent.succeeded
payment_intent.payment_failed
```

Set the endpoint signing secret as:

```text
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

Do not use live Stripe keys for the demo.

## 9. Test Order

1. `GET https://api.example.com/health` returns 200.
2. `GET https://api.example.com/api/health/readiness` returns 200 after DB/config are ready.
3. Frontend loads from Vercel over HTTPS.
4. Login returns a JWT whose header has `"alg": "ES512"`.
5. Create an order.
6. Pay with Stripe test card.
7. Stripe webhook returns 200.
8. Admin endpoint rejects non-admin JWT and accepts admin JWT.
9. CloudWatch shows startup and Stripe webhook logs.

Stop and capture evidence once these checks pass.
