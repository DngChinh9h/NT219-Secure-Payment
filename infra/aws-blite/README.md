# AWS Private Service Layout

This folder contains an EC2/RDS-oriented variant of the deployment helpers. The canonical deployment procedure is [manual-ec2-redeploy.md](../../docs/deployment/manual-ec2-redeploy.md).

The mandatory topology is:

- public Gateway/Nginx or an equivalent public reverse proxy;
- private backend EC2 on `3000`;
- private Security Service EC2 on HTTPS/mTLS `9443`;
- private PostgreSQL/RDS on `5432`.

`sg-backend` permits outbound `9443` only to `sg-security`; `sg-security` permits inbound `9443` only from `sg-backend`. Backend environment comes from `backend.env.example` and may contain only the Security Service client certificate/key, internal CA certificate, and JWT public key. `security-service.env.example` is the only template that contains JWT/receipt private-key paths and `KMS_MASTER_KEY`.

Do not mount `/opt/nt219/security-material/keys/security` into the backend container. Use `deploy-backend-ec2.sh` only after the Security Service is running privately and its mTLS material has been provisioned outside the repository.
