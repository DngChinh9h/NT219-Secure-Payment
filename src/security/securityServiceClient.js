"use strict";

const fs = require("fs");
const https = require("https");

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isReadable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getSecurityClientConfigStatus({ env = process.env, checkFiles = true } = {}) {
  let isHttps = false;
  try { isHttps = new URL(env.SECURITY_SERVICE_BASE_URL).protocol === "https:"; } catch {}
  const checks = {
    securityServiceHttps: isHttps,
    clientCertificateConfigured: !checkFiles || isReadable(env.SECURITY_CLIENT_CERT_PATH),
    clientPrivateKeyConfigured: !checkFiles || isReadable(env.SECURITY_CLIENT_KEY_PATH),
    internalCaConfigured: !checkFiles || isReadable(env.SECURITY_CA_CERT_PATH),
  };
  const labels = {
    securityServiceHttps: "SECURITY_SERVICE_BASE_URL using https",
    clientCertificateConfigured: "SECURITY_CLIENT_CERT_PATH",
    clientPrivateKeyConfigured: "SECURITY_CLIENT_KEY_PATH",
    internalCaConfigured: "SECURITY_CA_CERT_PATH",
  };
  const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => labels[name]);
  return { valid: missing.length === 0, checks, missing };
}

function validateSecurityClientConfig(options = {}) {
  const status = getSecurityClientConfigStatus(options);
  if (!status.valid) {
    throw new Error(`Security Service mTLS configuration is incomplete: ${status.missing.join(", ")}`);
  }
  return status;
}

function createMtlsAgent(env = process.env) {
  validateSecurityClientConfig({ env });
  return new https.Agent({
    cert: fs.readFileSync(env.SECURITY_CLIENT_CERT_PATH),
    key: fs.readFileSync(env.SECURITY_CLIENT_KEY_PATH),
    ca: fs.readFileSync(env.SECURITY_CA_CERT_PATH),
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    keepAlive: true,
  });
}

class SecurityServiceClient {
  constructor({ env = process.env, requestImpl = null } = {}) {
    this.env = env;
    this.requestImpl = requestImpl;
  }

  async request(method, requestPath, body) {
    if (this.requestImpl) return this.requestImpl({ method, path: requestPath, body });
    validateSecurityClientConfig({ env: this.env });
    const baseUrl = new URL(this.env.SECURITY_SERVICE_BASE_URL);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const agent = createMtlsAgent(this.env);

    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: "https:",
        hostname: baseUrl.hostname,
        port: baseUrl.port || 443,
        path: requestPath,
        method,
        agent,
        servername: baseUrl.hostname,
        headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {},
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          let parsed;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
          catch { return reject(new Error("Security Service returned invalid JSON")); }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(parsed.error || `Security Service returned HTTP ${response.statusCode}`);
            error.statusCode = response.statusCode;
            return reject(error);
          }
          return resolve(parsed);
        });
      });
      request.once("error", reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  async signJwt(payload) {
    const response = await this.request("POST", "/internal/sign-jwt", { payload });
    if (!response.token) throw new Error("Security Service did not return a JWT");
    return response.token;
  }

  async signReceipt(payload) {
    const response = await this.request("POST", "/internal/sign-receipt", { payload });
    if (!response.jws) throw new Error("Security Service did not return a receipt JWS");
    return response;
  }

  async verifyReceipt(jws) {
    const response = await this.request("POST", "/internal/verify-receipt", { jws });
    if (!response.valid) throw new Error("Invalid receipt");
    return response.payload;
  }

  async wrapKey(dataKey) {
    const response = await this.request("POST", "/internal/wrap-key", { dataKey: dataKey.toString("base64") });
    if (!response.wrappedDataKey) throw new Error("Security Service did not return a wrapped data key");
    return response.wrappedDataKey;
  }

  async unwrapKey(wrappedDataKey) {
    const response = await this.request("POST", "/internal/unwrap-key", { wrappedDataKey });
    const dataKey = Buffer.from(response.dataKey || "", "base64");
    if (dataKey.length !== 32) throw new Error("Security Service returned an invalid data key");
    return dataKey;
  }

  getPublicKeys() { return this.request("GET", "/internal/keys/public"); }
  rotateReceiptKey() { return this.request("POST", "/internal/rotate-receipt-key", {}); }
  health() { return this.request("GET", "/internal/health"); }
}

function getSecurityServiceClient() {
  return new SecurityServiceClient();
}

module.exports = {
  SecurityServiceClient,
  createMtlsAgent,
  getSecurityClientConfigStatus,
  getSecurityServiceClient,
  validateSecurityClientConfig,
};
