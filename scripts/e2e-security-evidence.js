"use strict";

const crypto = require("crypto");

const API_BASE_URL = (
  process.env.API_BASE_URL || "http://localhost:10000"
).replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CUSTOMER_EMAIL =
  process.env.E2E_CUSTOMER_EMAIL ||
  `e2e_security_${Date.now()}@example.com`;
const CUSTOMER_PASSWORD =
  process.env.E2E_CUSTOMER_PASSWORD || "Password123!";
const ORDER_TOTAL = 125000;
const SEEDED_PRODUCT_ID = "dd2cb336-6f7f-5bf3-9015-b2f682a8dae6";

const summary = [];
let currentStep = "startup";
let serverTimestamp = Date.now();

function fail(message, details) {
  const err = new Error(message);
  err.step = currentStep;
  if (details !== undefined) err.details = details;
  throw err;
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

function pass(label) {
  summary.push(`PASS ${label}`);
  console.log(`PASS ${label}`);
}

function redact(value) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return serialized
    .replace(/("(?:token|password|authorization)"\s*:\s*")[^"]+(")/gi, "$1[REDACTED]$2")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9._-]+\b/g, "[REDACTED_JWT]")
    .replace(/\bsk_(?:test|live)_[A-Za-z0-9]+\b/g, "[REDACTED]")
    .replace(/\bwhsec_[A-Za-z0-9]+\b/g, "[REDACTED]");
}

function setStep(step) {
  currentStep = step;
  console.log(`\n[${step}]`);
}

function expectedStatuses(expectedStatus) {
  return Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
}

async function request(
  method,
  path,
  { token, body, expectedStatus = 200 } = {},
) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    fail(`Request failed: ${method} ${path}: ${err.message}`);
  }

  const rawBody = await response.text();
  let parsedBody = null;
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  if (!expectedStatuses(expectedStatus).includes(response.status)) {
    fail(
      `Unexpected HTTP status for ${method} ${path}: ${response.status}`,
      { status: response.status, body: parsedBody },
    );
  }

  return { status: response.status, body: parsedBody };
}

async function login(email, password) {
  const { body } = await request("POST", "/api/auth/login", {
    body: { email, password },
  });
  assert(body?.token, "Login response is missing token", body);
  assert(body?.user, "Login response is missing user", body);
  return body;
}

async function registerCustomer() {
  const registration = await request("POST", "/api/auth/register", {
    body: {
      email: CUSTOMER_EMAIL,
      password: CUSTOMER_PASSWORD,
      fullName: "Security Evidence E2E Customer",
      address: "Security Evidence E2E Address",
      cccdNumber: "999999999998",
    },
    expectedStatus: [201, 409],
  });

  if (registration.status === 409) {
    return login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  }

  assert(registration.body?.token, "Registration response is missing token");
  return registration.body;
}

async function createOrder(customerToken) {
  const { body } = await request("POST", "/api/orders", {
    token: customerToken,
    body: {
      items: [
        {
          productId: SEEDED_PRODUCT_ID,
          quantity: 1,
        },
      ],
      shippingAddress: "Security Evidence E2E Address",
    },
    expectedStatus: 201,
  });
  assert(body?.order?.id, "Create order response is missing order.id", body);
  return body.order;
}

async function payMockBankSuccess(customerToken, orderId) {
  const { body } = await request("POST", "/api/payments/create-intent", {
    token: customerToken,
    body: {
      orderId,
      provider: "mock_bank",
      paymentToken: "mock_success",
      amount: ORDER_TOTAL,
      nonce: crypto.randomUUID(),
      timestamp: serverTimestamp,
    },
  });
  assert(body?.status === "succeeded", "MockBank payment did not succeed", body);
  return body;
}

async function getTransaction(customerToken, orderId) {
  const { body } = await request("GET", "/api/transactions/mine", {
    token: customerToken,
  });
  const transaction = body?.transactions?.find(
    (candidate) => candidate.order_id === orderId,
  );
  assert(transaction?.id, "Paid order transaction is missing", body);
  return transaction;
}

async function getReceipt(customerToken, transactionId) {
  const { body } = await request(
    "GET",
    `/api/transactions/${transactionId}/receipt`,
    { token: customerToken },
  );
  assert(body?.receipt, "Receipt response is missing receipt", body);
  return body.receipt;
}

async function createRefundRequest(customerToken, orderId, expectedStatus = 201) {
  return request("POST", "/api/refund-requests", {
    token: customerToken,
    body: {
      orderId,
      reason: "requested_by_customer",
      details: "Security evidence E2E refund",
    },
    expectedStatus,
  });
}

function assertProtectionEvidence(evidence) {
  assert(evidence && typeof evidence === "object", "Evidence response is empty");
  assert(evidence.receiptSigningEnabled === true, "Receipt signing evidence missing", evidence);
  assert(evidence.auditChain?.enabled === true, "Audit chain evidence missing", evidence);
  assert(typeof evidence.auditChain?.valid === "boolean", "Audit chain status missing", evidence);
  assert(evidence.duplicatePaymentProtection?.enabled === true, "Duplicate payment evidence missing", evidence);
  assert(evidence.replayProtection?.enabled === true, "Replay evidence missing", evidence);
  assert(evidence.refundDoubleSpendProtection?.enabled === true, "Refund double-spend evidence missing", evidence);
  assert(evidence.webhookIdempotency?.enabled === true, "Webhook idempotency evidence missing", evidence);
  assert(evidence.providerRefundEnabled === true, "Provider refund evidence missing", evidence);
  assert(evidence.hardening?.rateLimitEnabled === true, "Rate-limit hardening evidence missing", evidence);
  assert(evidence.hardening?.corsRestricted === true, "CORS hardening evidence missing", evidence);
  assert(evidence.hardening?.securityHeadersEnabled === true, "Header hardening evidence missing", evidence);
  assert(evidence.reconciliationEnabled === true, "Reconciliation evidence missing", evidence);
  assert(evidence.fraudRiskEvidenceEnabled === true, "Fraud risk evidence missing", evidence);
  assert(
    evidence.latestEvidenceTimestamps &&
      Object.keys(evidence.latestEvidenceTimestamps).length > 0,
    "Latest evidence timestamps missing",
    evidence,
  );
}

function tamperReceipt(receipt) {
  const parts = receipt.split(".");
  assert(parts.length === 3, "Receipt is not a three-part JWS");
  const payload = parts[1];
  const index = Math.max(0, payload.length - 1);
  const replacement = payload[index] === "A" ? "B" : "A";
  parts[1] = `${payload.slice(0, index)}${replacement}`;
  return parts.join(".");
}

async function run() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    fail("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required");
  }

  console.log(`E2E security evidence target: ${API_BASE_URL}`);
  console.log(`E2E customer email: ${CUSTOMER_EMAIL}`);

  setStep("health");
  const health = await request("GET", "/health");
  serverTimestamp = health.body?.time ? Date.parse(health.body.time) : Date.now();
  pass("health");

  setStep("admin login");
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert(admin.user.role === "admin", "Admin login did not return admin role");
  pass("admin login");

  setStep("customer setup");
  const customer = await registerCustomer();
  assert(customer.user?.role === "customer", "Customer setup did not return customer role");
  pass("customer setup");

  setStep("admin-only protection");
  await request("GET", "/api/admin/security/evidence", {
    token: customer.token,
    expectedStatus: 403,
  });
  await request("GET", "/api/admin/security/audit-chain/verify", {
    token: customer.token,
    expectedStatus: 403,
  });
  pass("admin-only protection");

  setStep("event generation");
  const order = await createOrder(customer.token);
  await payMockBankSuccess(customer.token, order.id);
  const transaction = await getTransaction(customer.token, order.id);
  const receipt = await getReceipt(customer.token, transaction.id);
  const refund = await createRefundRequest(customer.token, order.id);
  const refundRequestId = refund.body?.refundRequest?.id;
  assert(refundRequestId, "Refund request response is missing id", refund.body);
  await request(
    "POST",
    `/api/admin/refund-requests/${refundRequestId}/approve`,
    { token: admin.token },
  );
  pass("event generation");

  setStep("evidence endpoint");
  const evidence = await request("GET", "/api/admin/security/evidence", {
    token: admin.token,
  });
  assertProtectionEvidence(evidence.body);
  assert(
    !/STRIPE_SECRET_KEY|DATABASE_URL|PRIVATE_KEY|whsec_|sk_(?:test|live)_/i.test(
      JSON.stringify(evidence.body),
    ),
    "Evidence response leaked a secret marker",
    evidence.body,
  );
  pass("evidence endpoint");

  setStep("audit chain verify");
  const chain = await request("GET", "/api/admin/security/audit-chain/verify", {
    token: admin.token,
  });
  assert(chain.body?.valid === true, "Audit chain is invalid", chain.body);
  assert(chain.body.checked > 0, "Audit chain did not verify any rows", chain.body);
  assert(chain.body.brokenAt == null, "Audit chain reports a broken row", chain.body);
  pass("audit chain verify");

  setStep("receipt valid");
  const validReceipt = await request("POST", "/api/transactions/receipt/verify", {
    body: { receipt },
  });
  assert(validReceipt.body?.valid === true, "Real receipt did not verify", validReceipt.body);
  pass("receipt valid");

  setStep("receipt tampered invalid");
  const tamperedReceipt = await request("POST", "/api/transactions/receipt/verify", {
    body: { receipt: tamperReceipt(receipt) },
    expectedStatus: [200, 400],
  });
  assert(tamperedReceipt.status !== 500, "Tampered receipt returned 500", tamperedReceipt.body);
  assert(tamperedReceipt.body?.valid === false, "Tampered receipt was accepted", tamperedReceipt.body);
  pass("receipt tampered invalid");

  setStep("duplicate/replay protection evidence");
  await createRefundRequest(customer.token, order.id, [400, 409]);
  await request(
    "POST",
    `/api/admin/refund-requests/${refundRequestId}/approve`,
    { token: admin.token, expectedStatus: [400, 409] },
  );
  pass("duplicate/replay protection evidence");

  console.log("\nE2E Security Evidence Summary:");
  for (const line of summary) console.log(line);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("\nE2E Security Evidence FAILED");
    console.error(`Step: ${err.step || currentStep}`);
    console.error(err.message);
    if (err.details !== undefined) {
      console.error(redact(err.details));
    }
    process.exitCode = 1;
  });
