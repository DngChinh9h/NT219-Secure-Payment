"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.resolve(process.argv[2] || path.join(root, "local-secrets", "security-dev"));

function runOpenSsl(args) {
  execFileSync("openssl", args, { stdio: "inherit" });
}

function ensureDirectory(directory, mode) {
  fs.mkdirSync(directory, { recursive: true, mode });
}

function createCertificate({ commonName, keyPath, csrPath, certPath, caCertPath, caKeyPath, extensions }) {
  runOpenSsl(["genrsa", "-out", keyPath, "4096"]);
  runOpenSsl(["req", "-new", "-key", keyPath, "-subj", `/CN=${commonName}`, "-out", csrPath]);
  runOpenSsl([
    "x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath,
    "-CAcreateserial", "-out", certPath, "-days", "825", "-sha256", "-extfile", extensions,
  ]);
  fs.rmSync(csrPath, { force: true });
  fs.chmodSync(keyPath, 0o600);
  fs.chmodSync(certPath, 0o644);
}

function createEcKeyPair(privatePath, publicPath) {
  runOpenSsl(["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:secp521r1", "-out", privatePath]);
  runOpenSsl(["pkey", "-in", privatePath, "-pubout", "-out", publicPath]);
  fs.chmodSync(privatePath, 0o600);
  fs.chmodSync(publicPath, 0o644);
}

function main() {
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
    throw new Error(`Refusing to overwrite existing development material: ${output}`);
  }
  const certRoot = path.join(output, "certs");
  const caDir = path.join(certRoot, "ca");
  const backendDir = path.join(certRoot, "backend");
  const securityDir = path.join(certRoot, "security");
  const keyRoot = path.join(output, "keys");
  const publicKeyDir = path.join(keyRoot, "public");
  const privateKeyDir = path.join(keyRoot, "security", "receipt-private");
  const receiptPublicDir = path.join(keyRoot, "security", "receipt-public");
  [caDir, backendDir, securityDir, publicKeyDir, privateKeyDir, receiptPublicDir].forEach((directory) => ensureDirectory(directory, 0o700));

  const caKey = path.join(caDir, "internal-ca.key");
  const caCert = path.join(caDir, "internal-ca.crt");
  runOpenSsl(["genrsa", "-out", caKey, "4096"]);
  runOpenSsl(["req", "-x509", "-new", "-nodes", "-key", caKey, "-sha256", "-days", "825", "-subj", "/CN=NT219 Dev Internal CA", "-out", caCert]);

  const extensions = path.join(output, "openssl-internal.ext");
  fs.writeFileSync(extensions, "subjectAltName=DNS:security-service,DNS:localhost\nextendedKeyUsage=serverAuth,clientAuth\n", { mode: 0o600 });
  createCertificate({
    commonName: "security-service", keyPath: path.join(securityDir, "security-server.key"),
    csrPath: path.join(output, "security-server.csr"), certPath: path.join(securityDir, "security-server.crt"),
    caCertPath: caCert, caKeyPath: caKey, extensions,
  });
  createCertificate({
    commonName: "nt219-backend", keyPath: path.join(backendDir, "backend-client.key"),
    csrPath: path.join(output, "backend-client.csr"), certPath: path.join(backendDir, "backend-client.crt"),
    caCertPath: caCert, caKeyPath: caKey, extensions,
  });
  fs.rmSync(extensions, { force: true });

  createEcKeyPair(path.join(keyRoot, "security", "jwt-private.pem"), path.join(publicKeyDir, "jwt-public.pem"));
  createEcKeyPair(path.join(privateKeyDir, "receipt-v1-private.pem"), path.join(receiptPublicDir, "receipt-v1-public.pem"));
  fs.chmodSync(caKey, 0o600);
  fs.chmodSync(caCert, 0o644);
  fs.writeFileSync(path.join(receiptPublicDir, "active-version"), "1\n", { mode: 0o644 });
  console.log(`Generated development-only internal CA, mTLS certificates, and ES512 keys in ${output}`);
}

try { main(); } catch (err) { console.error(`Development certificate generation failed: ${err.message}`); process.exitCode = 1; }
