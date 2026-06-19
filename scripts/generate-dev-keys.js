"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const keysDir = path.resolve(__dirname, "../keys");
const privateKeyPath = path.join(keysDir, "private.pem");
const publicKeyPath = path.join(keysDir, "public.pem");

if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

if (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath)) {
  throw new Error("Refusing to overwrite existing local dev keys");
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

console.log(`Generated local dev private key: ${privateKeyPath}`);
console.log(`Generated local dev public key: ${publicKeyPath}`);
console.log("Do not commit generated key files.");
