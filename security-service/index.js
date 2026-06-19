"use strict";

require("dotenv").config({ quiet: true });
const fs = require("fs");
const https = require("https");
const { createSecurityApp } = require("./app");
const { validateSecurityServiceConfig } = require("./config");

function createMtlsServer({ env = process.env, app = createSecurityApp({ env }) } = {}) {
  validateSecurityServiceConfig({ env });
  return https.createServer({
    cert: fs.readFileSync(env.SECURITY_SERVER_CERT_PATH),
    key: fs.readFileSync(env.SECURITY_SERVER_KEY_PATH),
    ca: fs.readFileSync(env.SECURITY_CA_CERT_PATH),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  }, app);
}

function startSecurityServer({ env = process.env } = {}) {
  const server = createMtlsServer({ env });
  const port = Number(env.SECURITY_PORT || 9443);
  server.listen(port, () => console.log(`NT219 Security Service listening with mTLS on ${port}`));
  return server;
}

if (require.main === module) startSecurityServer();

module.exports = { createMtlsServer, startSecurityServer };
