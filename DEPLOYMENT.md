# Deployment

The production deployment requires the private Security Service for JWT ES512 signing, receipt ES512 signing/verification, key rotation, and AES-256-GCM envelope-key operations. The backend must not have private signing keys or `KMS_MASTER_KEY`.

Use the complete manual procedure in [manual-ec2-redeploy.md](docs/deployment/manual-ec2-redeploy.md).
