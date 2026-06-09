"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PRIVATE_KEY_PATH = path.join(__dirname, "../../keys/private.pem");
const DEFAULT_PUBLIC_KEY_PATH = path.join(__dirname, "../../keys/public.pem");

function readFileIfPresent(filePath) {
  if (!filePath) return null;
  return fs.readFileSync(filePath, "utf8");
}

function readBase64Pem(value) {
  if (!value) return null;
  return Buffer.from(value, "base64").toString("utf8");
}

function readConfiguredKey({
  pathValue,
  base64Value,
  rawValue,
  defaultPath,
}) {
  if (pathValue) return readFileIfPresent(pathValue);
  if (base64Value) return readBase64Pem(base64Value);
  if (rawValue) return rawValue.replace(/\\n/g, "\n");
  return readFileIfPresent(defaultPath);
}

function loadJwtSigningKeys(env = process.env) {
  return {
    privateKey: readConfiguredKey({
      pathValue: env.JWT_PRIVATE_KEY_PATH,
      base64Value: env.JWT_PRIVATE_KEY_B64,
      rawValue: env.JWT_PRIVATE_KEY,
      defaultPath: DEFAULT_PRIVATE_KEY_PATH,
    }),
    publicKey: readConfiguredKey({
      pathValue: env.JWT_PUBLIC_KEY_PATH,
      base64Value: env.JWT_PUBLIC_KEY_B64,
      rawValue: env.JWT_PUBLIC_KEY,
      defaultPath: DEFAULT_PUBLIC_KEY_PATH,
    }),
  };
}

function hasBase64Key(value) {
  if (!value) return false;
  try {
    return readBase64Pem(value).includes("BEGIN");
  } catch {
    return false;
  }
}

function isReadableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getJwtKeyConfigStatus(env = process.env) {
  return {
    privateKeyConfigured: isKeyConfigured({
      pathValue: env.JWT_PRIVATE_KEY_PATH,
      base64Value: env.JWT_PRIVATE_KEY_B64,
      rawValue: env.JWT_PRIVATE_KEY,
      defaultPath: DEFAULT_PRIVATE_KEY_PATH,
    }),
    publicKeyConfigured: isKeyConfigured({
      pathValue: env.JWT_PUBLIC_KEY_PATH,
      base64Value: env.JWT_PUBLIC_KEY_B64,
      rawValue: env.JWT_PUBLIC_KEY,
      defaultPath: DEFAULT_PUBLIC_KEY_PATH,
    }),
  };
}

function isKeyConfigured({
  pathValue,
  base64Value,
  rawValue,
  defaultPath,
}) {
  if (pathValue) return isReadableFile(pathValue);
  if (base64Value) return hasBase64Key(base64Value);
  if (rawValue) return true;
  return isReadableFile(defaultPath);
}

module.exports = {
  DEFAULT_PRIVATE_KEY_PATH,
  DEFAULT_PUBLIC_KEY_PATH,
  getJwtKeyConfigStatus,
  loadJwtSigningKeys,
};
