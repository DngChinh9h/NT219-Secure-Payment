# Generate ES512 JWT Keys

ES512 in JWT uses ECDSA with curve P-521 and SHA-512.

Create the private key:

```bash
openssl ecparam -name secp521r1 -genkey -noout -out jwt_private.pem
```

Create the public key:

```bash
openssl ec -in jwt_private.pem -pubout -out jwt_public.pem
```

Inspect the key:

```bash
openssl ec -in jwt_private.pem -text -noout
```

Expected:

- ASN1 OID: secp521r1
- NIST CURVE: P-521

Notes:

- Do not use RS512 or PS512 because they are still RSA/RSA-PSS.
- Do not commit the private key.
- Production private keys must live in AWS Secrets Manager or a tightly permissioned file on EC2.
- Legacy receipts signed with the previous RS256 key are not supported after this ES512 migration for the demo.
