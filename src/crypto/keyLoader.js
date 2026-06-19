"use strict";

const fs = require("fs");

function isReadableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function loadJwtPublicKey(env = process.env) {
  if (env.JWT_PUBLIC_KEY_PATH) return fs.readFileSync(env.JWT_PUBLIC_KEY_PATH, "utf8");
  if (env.SECURITY_PUBLIC_KEYS_CACHE) {
    try {
      const parsed = JSON.parse(env.SECURITY_PUBLIC_KEYS_CACHE);
      if (parsed.jwt?.publicKey) return parsed.jwt.publicKey;
    } catch {
      return env.SECURITY_PUBLIC_KEYS_CACHE.replace(/\\n/g, "\n");
    }
  }
  throw new Error("JWT public key is not configured");
}

function getJwtPublicKeyConfigStatus(env = process.env) {
  return {
    publicKeyConfigured:
      Boolean(env.JWT_PUBLIC_KEY_PATH && isReadableFile(env.JWT_PUBLIC_KEY_PATH)) ||
      Boolean(env.SECURITY_PUBLIC_KEYS_CACHE),
  };
}

module.exports = { getJwtPublicKeyConfigStatus, isReadableFile, loadJwtPublicKey };
