"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const skipDirs = new Set([".git", "node_modules", "coverage", "keys", "certs", "local-secrets", "runtime-output"]);
const forbiddenExtensions = new Set([".key", ".pem", ".p12", ".pfx"]);
const findings = [];

function isEnvFile(filePath) {
  const name = path.basename(filePath);
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
}

function scanFile(filePath) {
  const relative = path.relative(root, filePath);
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (forbiddenExtensions.has(ext)) {
    findings.push(`${relative}: forbidden key/cert file extension`);
  }
  if (isEnvFile(filePath)) {
    findings.push(`${relative}: environment file must not be committed or kept in repo`);
  }
  if (name === ".env.example") return;

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const beginToken = ["BE", "GIN"].join("");
  const privateKeyToken = ["PRIVATE", "KEY"].join(" ");
  const certificateToken = ["CERT", "IFICATE"].join("");
  const privateKeyPattern = new RegExp(`${beginToken} [A-Z ]*${privateKeyToken}`);
  const certificatePattern = new RegExp(`${beginToken} ${certificateToken}`);

  if (privateKeyPattern.test(content)) {
    findings.push(`${relative}: private key material pattern`);
  }
  if (certificatePattern.test(content) && !relative.includes("docs")) {
    findings.push(`${relative}: certificate material pattern`);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(fullPath);
      continue;
    }
    if (entry.isFile()) scanFile(fullPath);
  }
}

walk(root);

if (findings.length > 0) {
  console.error("Secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Secret scan passed.");
