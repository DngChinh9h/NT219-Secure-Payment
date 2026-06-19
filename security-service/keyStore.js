"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RECEIPT_FILE = /^receipt-v(\d+)-(private|public)\.pem$/;

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function receiptFile(directory, version, type) {
  return path.join(directory, `receipt-v${version}-${type}.pem`);
}

function getReceiptVersions(env = process.env) {
  const files = fs.readdirSync(env.RECEIPT_PUBLIC_KEY_DIR, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(RECEIPT_FILE))
    .filter((match) => match && match[2] === "public")
    .map((match) => Number(match[1]))
    .filter((version) => Number.isInteger(version) && version > 0)
    .sort((a, b) => a - b);
}

function readActiveVersion(env = process.env) {
  if (env.RECEIPT_ACTIVE_KEY_VERSION) return Number(env.RECEIPT_ACTIVE_KEY_VERSION);
  const activePath = path.join(env.RECEIPT_PUBLIC_KEY_DIR, "active-version");
  if (fs.existsSync(activePath)) return Number(readUtf8(activePath).trim());
  const versions = getReceiptVersions(env);
  return versions.at(-1) || 0;
}

function assertReceiptVersion(version, env = process.env) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Invalid receipt signing key version");
  }
  const publicPath = receiptFile(env.RECEIPT_PUBLIC_KEY_DIR, version, "public");
  if (!fs.existsSync(publicPath)) throw new Error(`Unknown receipt signing key version: ${version}`);
  return version;
}

function getReceiptPublicKey(version, env = process.env) {
  return readUtf8(receiptFile(env.RECEIPT_PUBLIC_KEY_DIR, assertReceiptVersion(version, env), "public"));
}

function getActiveReceiptSigningKey(env = process.env) {
  const version = assertReceiptVersion(readActiveVersion(env), env);
  const privatePath = receiptFile(env.RECEIPT_PRIVATE_KEY_DIR, version, "private");
  if (!fs.existsSync(privatePath)) throw new Error(`Receipt private key is unavailable for version: ${version}`);
  return { keyVersion: version, privateKey: readUtf8(privatePath), publicKey: getReceiptPublicKey(version, env) };
}

function getReceiptKeyStatus(env = process.env) {
  const activeKeyVersion = assertReceiptVersion(readActiveVersion(env), env);
  const availableKeyVersions = getReceiptVersions(env);
  return {
    activeKeyVersion,
    availableKeyVersions,
    keys: availableKeyVersions.map((keyVersion) => ({ keyVersion, active: keyVersion === activeKeyVersion })),
  };
}

function atomicWrite(filePath, value, mode) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, value, { mode });
  fs.renameSync(temporaryPath, filePath);
}

function rotateReceiptSigningKey(env = process.env) {
  const versions = getReceiptVersions(env);
  const nextVersion = (versions.at(-1) || 0) + 1;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp521r1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  atomicWrite(receiptFile(env.RECEIPT_PRIVATE_KEY_DIR, nextVersion, "private"), privateKey, 0o600);
  atomicWrite(receiptFile(env.RECEIPT_PUBLIC_KEY_DIR, nextVersion, "public"), publicKey, 0o644);
  atomicWrite(path.join(env.RECEIPT_PUBLIC_KEY_DIR, "active-version"), `${nextVersion}\n`, 0o644);
  return getReceiptKeyStatus(env);
}

function getJwtKeys(env = process.env) {
  return {
    privateKey: readUtf8(env.JWT_PRIVATE_KEY_PATH),
    publicKey: readUtf8(env.JWT_PUBLIC_KEY_PATH),
  };
}

module.exports = {
  getActiveReceiptSigningKey,
  getJwtKeys,
  getReceiptKeyStatus,
  getReceiptPublicKey,
  getReceiptVersions,
  rotateReceiptSigningKey,
};
