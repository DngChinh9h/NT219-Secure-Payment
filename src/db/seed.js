"use strict";
require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  await pool.query(
    `
        INSERT INTO users (email, password_hash, role)
        VALUES
          ('admin@demo.com',    $1, 'admin'),
          ('customer1@demo.com', $1, 'customer'),
          ('customer2@demo.com', $1, 'customer')
        ON CONFLICT (email) DO NOTHING
      `,
    [passwordHash],
  );

  console.log("✅ Seed completed");
  await pool.end();
}

seed();
