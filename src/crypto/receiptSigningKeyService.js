"use strict";

const crypto = require("crypto");
const db = require("../db");
const { aesEncrypt, aesDecrypt } = require("./aesHelper");

const LEGACY_KEY_VERSION = 1;
const ROTATION_LOCK_ID = 219005;

function isMissingKeyStoreError(err) {
  return err?.code === "42P01";
}

function getKmsService() {
  return require("../kms/kmsService");
}

function hasConfiguredMasterKey() {
  try {
    const { decodeMasterKey } = getKmsService();
    return Boolean(decodeMasterKey());
  } catch {
    return false;
  }
}

function decryptPrivateKey(row) {
  const { unwrapDataKey } = getKmsService();
  const dataKey = unwrapDataKey(row.wrapped_data_key);

  try {
    return aesDecrypt(
      {
        iv: row.private_key_iv,
        authTag: row.private_key_auth_tag,
        ciphertext: row.encrypted_private_key,
      },
      dataKey,
    );
  } finally {
    dataKey.fill(0);
  }
}

async function getActiveSigningKey() {
  try {
    const result = await db.query(
      `SELECT key_version, public_key, encrypted_private_key,
              private_key_iv, private_key_auth_tag, wrapped_data_key
       FROM receipt_signing_keys
       WHERE active = TRUE
       ORDER BY key_version DESC
       LIMIT 1`,
    );
    const row = result.rows[0];

    if (!row) return null;

    return {
      keyVersion: row.key_version,
      publicKey: row.public_key,
      privateKey: decryptPrivateKey(row),
    };
  } catch (err) {
    if (isMissingKeyStoreError(err)) return null;
    throw err;
  }
}

async function getPublicKeyForVersion(keyVersion) {
  try {
    const result = await db.query(
      `SELECT public_key
       FROM receipt_signing_keys
       WHERE key_version = $1
       LIMIT 1`,
      [keyVersion],
    );

    return result.rows[0]?.public_key || null;
  } catch (err) {
    if (isMissingKeyStoreError(err)) return null;
    throw err;
  }
}

async function getKeyStatus() {
  try {
    const result = await db.query(
      `SELECT key_version, active, created_at, rotated_at
       FROM receipt_signing_keys
       ORDER BY key_version ASC`,
    );
    const keys = result.rows.map((row) => ({
      keyVersion: row.key_version,
      active: row.active,
      createdAt: row.created_at,
      rotatedAt: row.rotated_at,
    }));
    const activeKey = keys.find((key) => key.active);
    const availableKeyVersions = [
      ...new Set([LEGACY_KEY_VERSION, ...keys.map((key) => key.keyVersion)]),
    ].sort((a, b) => a - b);

    return {
      activeKeyVersion: activeKey?.keyVersion || LEGACY_KEY_VERSION,
      availableKeyVersions,
      availablePublicKeyVersions: availableKeyVersions,
      keyRotationEnabled: hasConfiguredMasterKey(),
      keyStoreReady: true,
      keys,
    };
  } catch (err) {
    if (!isMissingKeyStoreError(err)) throw err;

    return {
      activeKeyVersion: LEGACY_KEY_VERSION,
      availableKeyVersions: [LEGACY_KEY_VERSION],
      availablePublicKeyVersions: [LEGACY_KEY_VERSION],
      keyRotationEnabled: false,
      keyStoreReady: false,
      keys: [],
    };
  }
}

async function rotateSigningKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp521r1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const { generateDataKey } = getKmsService();
  const { plaintext: dataKey, wrapped } = generateDataKey();
  let encrypted;

  try {
    encrypted = aesEncrypt(privateKey, dataKey);
  } finally {
    dataKey.fill(0);
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ROTATION_LOCK_ID]);

    const versionResult = await client.query(
      `SELECT COALESCE(MAX(key_version), $1) + 1 AS next_version
       FROM receipt_signing_keys`,
      [LEGACY_KEY_VERSION],
    );
    const nextVersion = Number(versionResult.rows[0].next_version);

    await client.query(
      `UPDATE receipt_signing_keys
       SET active = FALSE,
           rotated_at = NOW()
       WHERE active = TRUE`,
    );
    await client.query(
      `INSERT INTO receipt_signing_keys
        (key_version, public_key, encrypted_private_key, private_key_iv,
         private_key_auth_tag, wrapped_data_key, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [
        nextVersion,
        publicKey,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        wrapped,
      ],
    );
    await client.query("COMMIT");

    return getKeyStatus();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  LEGACY_KEY_VERSION,
  getActiveSigningKey,
  getPublicKeyForVersion,
  getKeyStatus,
  rotateSigningKey,
};
