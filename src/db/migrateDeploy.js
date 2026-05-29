"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const sql = fs.readFileSync(
    path.join(__dirname, "schema.deploy.sql"),
    "utf8"
  );

  try {
    await pool.query(sql);
    console.log("✅ Deploy-safe migration completed");
  } catch (err) {
    console.error("❌ Deploy-safe migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
