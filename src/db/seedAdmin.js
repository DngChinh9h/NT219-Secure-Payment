"use strict";

require("dotenv").config();

const db = require("./index");
const { hashPassword } = require("../users/userService");
const { encryptUserPII } = require("../users/piiService");

const DEFAULT_ADMIN_PII = Object.freeze({
  fullName: "Operations Admin",
  address: "Admin Office",
  cccdNumber: "000000000001",
});

const ENCRYPTED_PII_COLUMNS = [
  "encrypted_name",
  "name_iv",
  "name_auth_tag",
  "encrypted_address",
  "address_iv",
  "address_auth_tag",
  "encrypted_cccd",
  "cccd_iv",
  "cccd_auth_tag",
  "wrapped_data_key",
];

function validateAdminPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128 ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new Error(
      "ADMIN_PASSWORD does not meet policy: use 8-128 characters with an uppercase letter and a number",
    );
  }
}

function getAdminPII(env) {
  return {
    fullName: env.ADMIN_FULL_NAME || DEFAULT_ADMIN_PII.fullName,
    address: env.ADMIN_ADDRESS || DEFAULT_ADMIN_PII.address,
    cccdNumber: env.ADMIN_CCCD_NUMBER || DEFAULT_ADMIN_PII.cccdNumber,
  };
}

function redactSecrets(value, env = process.env) {
  let safeValue = String(value || "");
  const secrets = [
    env.ADMIN_PASSWORD,
    env.DATABASE_URL,
    env.STRIPE_SECRET_KEY,
    env.STRIPE_WEBHOOK_SECRET,
    env.JWT_PRIVATE_KEY,
    env.JWT_PUBLIC_KEY,
    env.HMAC_SECRET,
    env.KMS_MASTER_KEY,
  ].filter(Boolean);

  for (const secret of secrets) {
    safeValue = safeValue.split(secret).join("[REDACTED]");
  }

  return safeValue;
}

function getSafeErrorReason(err, env = process.env) {
  const reasons = [];

  function addReason(error) {
    if (!error) return;
    const message = redactSecrets(error.message, env);
    const code = redactSecrets(error.code, env);
    const reason = [code, message].filter(Boolean).join(": ");
    if (reason && !reasons.includes(reason)) reasons.push(reason);

    if (Array.isArray(error.errors)) {
      for (const nestedError of error.errors) addReason(nestedError);
    }
  }

  addReason(err);
  return reasons.join("; ") || redactSecrets(err?.name, env) || "Unknown error";
}

function getSafeStack(err, env = process.env) {
  const stacks = [err?.stack];

  if (Array.isArray(err?.errors)) {
    stacks.push(...err.errors.map((nestedError) => nestedError.stack));
  }

  return redactSecrets(stacks.filter(Boolean).join("\nCaused by:\n"), env);
}

function printStartupDiagnostics(env = process.env) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();

  console.log("Admin seed diagnostics:");
  console.log(`- ADMIN_EMAIL present: ${email ? "yes" : "no"}`);
  console.log(`- ADMIN_PASSWORD present: ${env.ADMIN_PASSWORD ? "yes" : "no"}`);
  console.log(`- DATABASE_URL present: ${env.DATABASE_URL ? "yes" : "no"}`);
  console.log(`- target admin email: ${email || "(not set)"}`);
  console.log(`- ADMIN_RESET_PASSWORD: ${env.ADMIN_RESET_PASSWORD === "true"}`);
}

async function checkDatabaseConnection(database) {
  await database.query("SELECT 1");
}

async function getUsersColumns(database) {
  const result = await database.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'`,
  );

  if (result.rows.length === 0) {
    throw new Error('relation "users" does not exist; run npm run migrate:deploy');
  }

  return new Set(result.rows.map((row) => row.column_name));
}

function assertRequiredUsersColumns(columns) {
  for (const column of ["id", "email", "password_hash", "role"]) {
    if (!columns.has(column)) {
      throw new Error(
        `users.${column} column does not exist; run npm run migrate:deploy`,
      );
    }
  }
}

async function insertAdmin({ database, columns, email, passwordHash, pii }) {
  const supportsEncryptedPII = ENCRYPTED_PII_COLUMNS.every((column) =>
    columns.has(column),
  );

  if (!supportsEncryptedPII) {
    const result = await database.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role`,
      [email, passwordHash],
    );
    return result.rows[0];
  }

  const encryptedPII = encryptUserPII(pii);
  const result = await database.query(
    `INSERT INTO users (
       email, password_hash, role,
       encrypted_name, name_iv, name_auth_tag,
       encrypted_address, address_iv, address_auth_tag,
       encrypted_cccd, cccd_iv, cccd_auth_tag,
       wrapped_data_key
     )
     VALUES ($1, $2, 'admin', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, email, role`,
    [
      email,
      passwordHash,
      encryptedPII.encrypted_name,
      encryptedPII.name_iv,
      encryptedPII.name_auth_tag,
      encryptedPII.encrypted_address,
      encryptedPII.address_iv,
      encryptedPII.address_auth_tag,
      encryptedPII.encrypted_cccd,
      encryptedPII.cccd_iv,
      encryptedPII.cccd_auth_tag,
      encryptedPII.wrapped_data_key,
    ],
  );
  return result.rows[0];
}

async function seedAdmin({
  env = process.env,
  database = db,
  onConnectionCheck = () => {},
} = {}) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;

  if (!email || !password) {
    return {
      skipped: true,
      message: "Admin seed skipped: ADMIN_EMAIL and ADMIN_PASSWORD are required",
    };
  }

  if (database === db && !env.DATABASE_URL) {
    onConnectionCheck("fail");
    throw new Error("DATABASE_URL is missing");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }

  validateAdminPassword(password);

  try {
    await checkDatabaseConnection(database);
    onConnectionCheck("ok");
  } catch (err) {
    onConnectionCheck("fail");
    throw err;
  }

  const columns = await getUsersColumns(database);
  assertRequiredUsersColumns(columns);

  const existingResult = await database.query(
    "SELECT id, email, role, password_hash FROM users WHERE email = $1 LIMIT 1",
    [email],
  );
  const existing = existingResult.rows[0];
  const resetPassword = env.ADMIN_RESET_PASSWORD === "true";

  if (existing) {
    if (resetPassword) {
      const passwordHash = await hashPassword(password);
      const updateResult = await database.query(
        `UPDATE users
         SET role = 'admin', password_hash = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, role`,
        [passwordHash, existing.id],
      );

      return {
        created: false,
        passwordReset: true,
        user: updateResult.rows[0],
        message: "Admin user role ensured and password reset",
      };
    }

    if (existing.role !== "admin") {
      const updateResult = await database.query(
        `UPDATE users
         SET role = 'admin', updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, role`,
        [existing.id],
      );

      return {
        created: false,
        passwordReset: false,
        user: updateResult.rows[0],
        message: "Existing user promoted to admin",
      };
    }

    return {
      created: false,
      passwordReset: false,
      user: { id: existing.id, email: existing.email, role: existing.role },
      message: "Admin user already exists",
    };
  }

  const passwordHash = await hashPassword(password);
  const user = await insertAdmin({
    database,
    columns,
    email,
    passwordHash,
    pii: getAdminPII(env),
  });

  return {
    created: true,
    passwordReset: false,
    user,
    message: "Admin user created",
  };
}

async function runFromCli() {
  printStartupDiagnostics();

  try {
    const result = await seedAdmin({
      onConnectionCheck(status) {
        console.log(`- DB connection: ${status}`);
      },
    });
    console.log(result.message);
  } catch (err) {
    console.error(`Admin seed failed: ${getSafeErrorReason(err)}`);
    if (process.env.NODE_ENV !== "production") {
      console.error(getSafeStack(err));
    }
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  runFromCli();
}

module.exports = {
  DEFAULT_ADMIN_PII,
  assertRequiredUsersColumns,
  checkDatabaseConnection,
  getAdminPII,
  getSafeErrorReason,
  getSafeStack,
  getUsersColumns,
  insertAdmin,
  printStartupDiagnostics,
  redactSecrets,
  runFromCli,
  seedAdmin,
  validateAdminPassword,
};
