# AWS Private Service Evidence Checklist

- Gateway is the only Internet-reachable host and exposes only `80/443`.
- Backend has no public inbound rule; it accepts `3000` only from the Gateway security group.
- Security Service has no public inbound rule; it accepts `9443` only from the backend security group.
- Database accepts `5432` only from backend.
- Backend container mounts only `/run/certs/backend`, `/run/certs/ca`, and `/run/public` read-only.
- Security Service alone mounts JWT private key, receipt private directory, and `KMS_MASTER_KEY`.
- mTLS health command succeeds with the backend certificate and fails without it.
- Login produces ES512 JWT; receipt verification succeeds, then fails after payload tampering.
- Key rotation advances `key_version` while an old receipt still verifies.
- Audit-chain verification succeeds and Stripe webhook evidence shows verified/reconciled processing.
