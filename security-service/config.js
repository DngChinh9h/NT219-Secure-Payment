"use strict";

const fs = require("fs");

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isReadableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isValidMasterKey(value) {
  if (!isPresent(value)) return false;
  if (/^[a-fA-F0-9]{64}$/.test(value.trim())) return true;
  try {
    return Buffer.from(value.trim(), "base64").length === 32;
  } catch {
    return false;
  }
}

function getSecurityServiceConfigStatus({ env = process.env, checkFiles = true } = {}) {
  const checks = {
    securityPortPresent: isPresent(env.SECURITY_PORT),
    serverCertificateConfigured: !checkFiles || isReadableFile(env.SECURITY_SERVER_CERT_PATH),
    serverPrivateKeyConfigured: !checkFiles || isReadableFile(env.SECURITY_SERVER_KEY_PATH),
    internalCaConfigured: !checkFiles || isReadableFile(env.SECURITY_CA_CERT_PATH),
    jwtPrivateKeyConfigured: !checkFiles || isReadableFile(env.JWT_PRIVATE_KEY_PATH),
    jwtPublicKeyConfigured: !checkFiles || isReadableFile(env.JWT_PUBLIC_KEY_PATH),
    receiptPrivateKeyDirectoryConfigured:
      !checkFiles || isDirectory(env.RECEIPT_PRIVATE_KEY_DIR),
    receiptPublicKeyDirectoryConfigured:
      !checkFiles || isDirectory(env.RECEIPT_PUBLIC_KEY_DIR),
    kmsMasterKeyPresent: isValidMasterKey(env.KMS_MASTER_KEY),
  };
  const labels = {
    securityPortPresent: "SECURITY_PORT",
    serverCertificateConfigured: "SECURITY_SERVER_CERT_PATH",
    serverPrivateKeyConfigured: "SECURITY_SERVER_KEY_PATH",
    internalCaConfigured: "SECURITY_CA_CERT_PATH",
    jwtPrivateKeyConfigured: "JWT_PRIVATE_KEY_PATH",
    jwtPublicKeyConfigured: "JWT_PUBLIC_KEY_PATH",
    receiptPrivateKeyDirectoryConfigured: "RECEIPT_PRIVATE_KEY_DIR",
    receiptPublicKeyDirectoryConfigured: "RECEIPT_PUBLIC_KEY_DIR",
    kmsMasterKeyPresent: "KMS_MASTER_KEY as 32 bytes encoded hex or base64",
  };
  const missing = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => labels[name]);

  return { valid: missing.length === 0, checks, missing };
}

function validateSecurityServiceConfig(options = {}) {
  const status = getSecurityServiceConfigStatus(options);
  if (!status.valid) {
    throw new Error(`Security Service configuration is incomplete: ${status.missing.join(", ")}`);
  }
  return status;
}

module.exports = {
  getSecurityServiceConfigStatus,
  isDirectory,
  isPresent,
  isReadableFile,
  isValidMasterKey,
  validateSecurityServiceConfig,
};
