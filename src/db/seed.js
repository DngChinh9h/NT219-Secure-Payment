"use strict";

require("dotenv").config();

const db = require("./index");
const { hashPassword } = require("../users/userService");
const { encryptUserPII } = require("../users/piiService");

const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD || "ChangeMe123!";

const USERS = [
  {
    email: process.env.ADMIN_EMAIL || "admin@example.test",
    role: "admin",
    fullName: "Seed Admin",
    address: "Seed Admin Office",
    cccdNumber: "000000000001",
  },
  {
    email: process.env.SEED_CUSTOMER_EMAIL || "customer@example.test",
    role: "customer",
    fullName: "Seed Customer",
    address: "Seed Customer Address",
    cccdNumber: "000000000002",
  },
  {
    email: process.env.SEED_MERCHANT_EMAIL || "merchant@example.test",
    role: "merchant",
    fullName: "Seed Merchant",
    address: "Seed Merchant Address",
    cccdNumber: "000000000003",
  },
];

async function upsertUser(user) {
  const passwordHash = await hashPassword(
    user.role === "admin" ? process.env.ADMIN_PASSWORD || DEV_PASSWORD : DEV_PASSWORD,
  );
  const pii = encryptUserPII(user);
  const result = await db.query(
    `INSERT INTO users (
       email, password_hash, role,
       encrypted_name, name_iv, name_auth_tag,
       encrypted_address, address_iv, address_auth_tag,
       encrypted_cccd, cccd_iv, cccd_auth_tag,
       wrapped_data_key
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (email)
     DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
     RETURNING id, email, role`,
    [
      user.email,
      passwordHash,
      user.role,
      pii.encrypted_name,
      pii.name_iv,
      pii.name_auth_tag,
      pii.encrypted_address,
      pii.address_iv,
      pii.address_auth_tag,
      pii.encrypted_cccd,
      pii.cccd_iv,
      pii.cccd_auth_tag,
      pii.wrapped_data_key,
    ],
  );
  return result.rows[0];
}

async function upsertMerchant(merchantUser) {
  const result = await db.query(
    `INSERT INTO merchants (user_id, display_name, status)
     VALUES ($1, $2, 'active')
     ON CONFLICT (user_id)
     DO UPDATE SET display_name = EXCLUDED.display_name,
                   status = 'active',
                   updated_at = NOW()
     RETURNING *`,
    [merchantUser.id, "NT219 Demo Merchant"],
  );
  return result.rows[0];
}

async function upsertProducts(merchant) {
  const products = [
    ["secure-checkout-lab", "Secure Checkout Lab Kit", 125000, "vnd"],
    ["payment-gateway-demo", "Payment Gateway Demo Access", 75000, "vnd"],
  ];
  const rows = [];

  for (const [sku, name, price, currency] of products) {
    const result = await db.query(
      `INSERT INTO products (id, merchant_id, name, price, currency, active)
       VALUES (uuid_generate_v5(uuid_ns_url(), $1), $2, $3, $4, $5, TRUE)
       ON CONFLICT (id)
       DO UPDATE SET merchant_id = EXCLUDED.merchant_id,
                     name = EXCLUDED.name,
                     price = EXCLUDED.price,
                     currency = EXCLUDED.currency,
                     active = TRUE,
                     updated_at = NOW()
       RETURNING *`,
      [`nt219:${sku}`, merchant.id, name, price, currency],
    );
    rows.push(result.rows[0]);
  }

  return rows;
}

async function seed() {
  console.log("Seeding dev/test users with non-production placeholder password.");
  console.log(`Dev/test password source: ${process.env.SEED_DEV_PASSWORD ? "SEED_DEV_PASSWORD" : "ChangeMe123! placeholder"}`);

  const users = {};
  for (const user of USERS) {
    users[user.role] = await upsertUser(user);
  }

  const merchant = await upsertMerchant(users.merchant);
  const products = await upsertProducts(merchant);

  return {
    users,
    merchant,
    products,
  };
}

async function runFromCli() {
  try {
    const result = await seed();
    console.log("Seed completed");
    console.log(JSON.stringify({
      admin: result.users.admin.email,
      customer: result.users.customer.email,
      merchant: result.users.merchant.email,
      productIds: result.products.map((product) => product.id),
    }, null, 2));
  } catch (err) {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  runFromCli();
}

module.exports = {
  DEV_PASSWORD,
  seed,
  runFromCli,
};
