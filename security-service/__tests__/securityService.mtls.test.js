"use strict";

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const jwt = require("jsonwebtoken");
const os = require("os");
const path = require("path");
const { createMtlsServer } = require("../index");
const { SecurityServiceClient } = require("../../src/security/securityServiceClient");

function openssl(args) { execFileSync("openssl", args, { stdio: "ignore" }); }
function writeKeyPair(privatePath, publicPath) {
  const pair = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp521r1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
  fs.writeFileSync(publicPath, pair.publicKey, { mode: 0o644 });
}

function signCertificate({ root, name, commonName, caCert, caKey, extension }) {
  const key = path.join(root, `${name}.key`);
  const csr = path.join(root, `${name}.csr`);
  const cert = path.join(root, `${name}.crt`);
  const extensionPath = path.join(root, `${name}.ext`);
  fs.writeFileSync(extensionPath, extension);
  openssl(["genrsa", "-out", key, "2048"]);
  openssl(["req", "-new", "-key", key, "-subj", `/CN=${commonName}`, "-out", csr]);
  openssl(["x509", "-req", "-in", csr, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", "2", "-sha256", "-extfile", extensionPath]);
  return { key, cert };
}

function createMaterial() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nt219-security-mtls-"));
  const caKey = path.join(root, "ca.key");
  const caCert = path.join(root, "ca.crt");
  openssl(["genrsa", "-out", caKey, "2048"]);
  openssl(["req", "-x509", "-new", "-key", caKey, "-sha256", "-days", "2", "-subj", "/CN=NT219 Test CA", "-out", caCert]);
  const server = signCertificate({ root, name: "server", commonName: "localhost", caCert, caKey, extension: "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n" });
  const client = signCertificate({ root, name: "client", commonName: "backend", caCert, caKey, extension: "extendedKeyUsage=clientAuth\n" });
  const wrongCaKey = path.join(root, "wrong-ca.key");
  const wrongCaCert = path.join(root, "wrong-ca.crt");
  openssl(["genrsa", "-out", wrongCaKey, "2048"]);
  openssl(["req", "-x509", "-new", "-key", wrongCaKey, "-sha256", "-days", "2", "-subj", "/CN=Wrong CA", "-out", wrongCaCert]);
  const wrongClient = signCertificate({ root, name: "wrong-client", commonName: "wrong", caCert: wrongCaCert, caKey: wrongCaKey, extension: "extendedKeyUsage=clientAuth\n" });
  const receiptPrivate = path.join(root, "receipt-private");
  const receiptPublic = path.join(root, "receipt-public");
  fs.mkdirSync(receiptPrivate); fs.mkdirSync(receiptPublic);
  writeKeyPair(path.join(root, "jwt-private.pem"), path.join(root, "jwt-public.pem"));
  writeKeyPair(path.join(receiptPrivate, "receipt-v1-private.pem"), path.join(receiptPublic, "receipt-v1-public.pem"));
  fs.writeFileSync(path.join(receiptPublic, "active-version"), "1\n");
  return {
    root, server, client, wrongClient,
    env: {
      SECURITY_PORT: "9443",
      SECURITY_SERVER_CERT_PATH: server.cert,
      SECURITY_SERVER_KEY_PATH: server.key,
      SECURITY_CA_CERT_PATH: caCert,
      JWT_PRIVATE_KEY_PATH: path.join(root, "jwt-private.pem"),
      JWT_PUBLIC_KEY_PATH: path.join(root, "jwt-public.pem"),
      RECEIPT_PRIVATE_KEY_DIR: receiptPrivate,
      RECEIPT_PUBLIC_KEY_DIR: receiptPublic,
      KMS_MASTER_KEY: crypto.randomBytes(32).toString("base64"),
    },
  };
}

function rawRequest({ port, ca, cert, key, path: requestPath = "/internal/health" }) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: "localhost", port, path: requestPath, ca, cert, key, rejectUnauthorized: true }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

describe("Security Service mTLS, signer, and KMS boundary", () => {
  let material;
  let server;
  let client;

  beforeAll(async () => {
    material = createMaterial();
    server = createMtlsServer({ env: material.env });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    client = new SecurityServiceClient({ env: {
      SECURITY_SERVICE_BASE_URL: `https://localhost:${port}`,
      SECURITY_CLIENT_CERT_PATH: material.client.cert,
      SECURITY_CLIENT_KEY_PATH: material.client.key,
      SECURITY_CA_CERT_PATH: material.env.SECURITY_CA_CERT_PATH,
    } });
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (material) fs.rmSync(material.root, { recursive: true, force: true });
  });

  test("rejects absent and untrusted client certificates", async () => {
    const port = server.address().port;
    await expect(rawRequest({ port, ca: fs.readFileSync(material.env.SECURITY_CA_CERT_PATH) })).rejects.toThrow();
    await expect(rawRequest({ port, ca: fs.readFileSync(material.env.SECURITY_CA_CERT_PATH), cert: fs.readFileSync(material.wrongClient.cert), key: fs.readFileSync(material.wrongClient.key) })).rejects.toThrow();
  });

  test("accepts the backend mTLS certificate and performs JWT, receipt, and KMS operations", async () => {
    await expect(client.health()).resolves.toMatchObject({ status: "ok", mtls: true });
    const token = await client.signJwt({ userId: "customer-1", email: "customer@example.test", role: "customer" });
    await expect(jwt.verify(token, fs.readFileSync(material.env.JWT_PUBLIC_KEY_PATH, "utf8"), { algorithms: ["ES512"], issuer: "payment-system", audience: "payment-api" })).toMatchObject({ userId: "customer-1" });

    const receiptPayload = {
      receipt_id: "receipt-1", order_id: "order-1", transaction_id: "transaction-1", payer_user_id: "customer-1", merchant_id: "merchant-1",
      provider: "mock_bank", provider_payment_id: "payment-1", amount: 100000, currency: "vnd", status: "PAID", order_items_hash: "items-hash",
      issued_at: "2026-06-19T00:00:00.000Z", issuer: "payment-system", audience: "payment-receipt",
    };
    const oldReceipt = await client.signReceipt(receiptPayload);
    await expect(client.verifyReceipt(oldReceipt.jws)).resolves.toMatchObject({ key_version: 1, merchant_id: "merchant-1" });
    const parts = oldReceipt.jws.split(".");
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    body.amount = 1;
    parts[1] = Buffer.from(JSON.stringify(body)).toString("base64url");
    await expect(client.verifyReceipt(parts.join("."))).rejects.toThrow("Invalid receipt");

    await expect(client.rotateReceiptKey()).resolves.toMatchObject({ activeKeyVersion: 2, availableKeyVersions: [1, 2] });
    const newReceipt = await client.signReceipt(receiptPayload);
    await expect(client.verifyReceipt(oldReceipt.jws)).resolves.toMatchObject({ key_version: 1 });
    await expect(client.verifyReceipt(newReceipt.jws)).resolves.toMatchObject({ key_version: 2 });

    const dataKey = crypto.randomBytes(32);
    const wrapped = await client.wrapKey(dataKey);
    expect(JSON.parse(wrapped)).toMatchObject({ alg: "AES-256-GCM", v: 1 });
    await expect(client.unwrapKey(wrapped)).resolves.toEqual(dataKey);
    const tampered = JSON.parse(wrapped);
    tampered.authTag = Buffer.alloc(16).toString("base64");
    await expect(client.unwrapKey(JSON.stringify(tampered))).rejects.toThrow();
  });
});
