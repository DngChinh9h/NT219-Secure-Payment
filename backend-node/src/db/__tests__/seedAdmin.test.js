"use strict";

const bcrypt = require("bcryptjs");

const mockEncryptUserPII = jest.fn(() => ({
  encrypted_name: "enc-name",
  name_iv: "name-iv",
  name_auth_tag: "name-tag",
  encrypted_address: "enc-address",
  address_iv: "address-iv",
  address_auth_tag: "address-tag",
  encrypted_cccd: "enc-cccd",
  cccd_iv: "cccd-iv",
  cccd_auth_tag: "cccd-tag",
  wrapped_data_key: "wrapped-key",
}));

jest.mock("../../users/piiService", () => ({
  encryptUserPII: mockEncryptUserPII,
}));

const {
  DEFAULT_ADMIN_PII,
  getSafeErrorReason,
  seedAdmin,
  validateAdminPassword,
} = require("../seedAdmin");

function createFakeDatabase({ includeRole = true } = {}) {
  const users = new Map();
  const query = jest.fn(async (sql, params) => {
    if (sql === "SELECT 1") {
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }

    if (sql.includes("information_schema.columns")) {
      const columns = [
        "id",
        "email",
        "password_hash",
        ...(includeRole ? ["role"] : []),
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
      return {
        rowCount: columns.length,
        rows: columns.map((column_name) => ({ column_name })),
      };
    }

    if (sql.includes("SELECT id, email, role, password_hash")) {
      const user = users.get(params[0]);
      return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
    }

    if (sql.includes("INSERT INTO users")) {
      const user = {
        id: "admin-id",
        email: params[0],
        password_hash: params[1],
        role: "admin",
      };
      users.set(user.email, user);
      return { rowCount: 1, rows: [user] };
    }

    if (sql.includes("password_hash = $1")) {
      const existing = [...users.values()].find((user) => user.id === params[1]);
      const updated = { ...existing, password_hash: params[0], role: "admin" };
      users.set(updated.email, updated);
      return { rowCount: 1, rows: [updated] };
    }

    if (sql.includes("SET role = 'admin'")) {
      const existing = [...users.values()].find((user) => user.id === params[0]);
      const updated = { ...existing, role: "admin" };
      users.set(updated.email, updated);
      return { rowCount: 1, rows: [updated] };
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  });

  return { query, users };
}

describe("seedAdmin", () => {
  const baseEnv = {
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD: "AdminPassword123!",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("creates an admin with a bcrypt password hash", async () => {
    const database = createFakeDatabase();

    const result = await seedAdmin({ env: baseEnv, database });
    const stored = database.users.get("admin@example.com");

    expect(result.created).toBe(true);
    expect(stored.role).toBe("admin");
    expect(stored.password_hash).not.toBe(baseEnv.ADMIN_PASSWORD);
    await expect(
      bcrypt.compare(baseEnv.ADMIN_PASSWORD, stored.password_hash),
    ).resolves.toBe(true);
  });

  test("is idempotent and creates only one user", async () => {
    const database = createFakeDatabase();

    await seedAdmin({ env: baseEnv, database });
    const secondResult = await seedAdmin({ env: baseEnv, database });

    expect(secondResult.created).toBe(false);
    expect(database.users.size).toBe(1);
    expect(
      database.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO users")),
    ).toHaveLength(1);
  });

  test("resets password only when ADMIN_RESET_PASSWORD=true", async () => {
    const database = createFakeDatabase();
    await seedAdmin({ env: baseEnv, database });
    const originalHash = database.users.get("admin@example.com").password_hash;

    const result = await seedAdmin({
      env: {
        ...baseEnv,
        ADMIN_PASSWORD: "NewAdminPassword456!",
        ADMIN_RESET_PASSWORD: "true",
      },
      database,
    });
    const updatedHash = database.users.get("admin@example.com").password_hash;

    expect(result.passwordReset).toBe(true);
    expect(updatedHash).not.toBe(originalHash);
    await expect(bcrypt.compare("NewAdminPassword456!", updatedHash)).resolves.toBe(
      true,
    );
  });

  test("encrypts PII when all optional fields are supplied", async () => {
    const database = createFakeDatabase();
    const pii = {
      ADMIN_FULL_NAME: "Operations Admin",
      ADMIN_ADDRESS: "Admin Office",
      ADMIN_CCCD_NUMBER: "000000000001",
    };

    await seedAdmin({ env: { ...baseEnv, ...pii }, database });

    expect(mockEncryptUserPII).toHaveBeenCalledWith({
      fullName: pii.ADMIN_FULL_NAME,
      address: pii.ADMIN_ADDRESS,
      cccdNumber: pii.ADMIN_CCCD_NUMBER,
    });
  });

  test("uses safe PII defaults when optional fields are missing", async () => {
    const database = createFakeDatabase();

    await seedAdmin({ env: baseEnv, database });

    expect(mockEncryptUserPII).toHaveBeenCalledWith(DEFAULT_ADMIN_PII);
  });

  test("skips cleanly when required env is missing", async () => {
    await expect(seedAdmin({ env: {}, database: createFakeDatabase() })).resolves.toEqual({
      skipped: true,
      message: "Admin seed skipped: ADMIN_EMAIL and ADMIN_PASSWORD are required",
    });
  });

  test("rejects weak admin password", () => {
    expect(() => validateAdminPassword("weak")).toThrow("ADMIN_PASSWORD");
  });

  test("reports missing role column with deploy-safe migration guidance", async () => {
    await expect(
      seedAdmin({ env: baseEnv, database: createFakeDatabase({ includeRole: false }) }),
    ).rejects.toThrow("users.role column does not exist; run npm run migrate:deploy");
  });

  test("formats AggregateError safely without exposing database URL", () => {
    const databaseUrl = "postgres://admin:secret@localhost:5432/payment";
    const error = new AggregateError([
      Object.assign(new Error(`connect ECONNREFUSED ${databaseUrl}`), {
        code: "ECONNREFUSED",
      }),
    ]);

    const message = getSafeErrorReason(error, { DATABASE_URL: databaseUrl });

    expect(message).toContain("ECONNREFUSED");
    expect(message).not.toContain(databaseUrl);
    expect(message).toContain("[REDACTED]");
  });
});
