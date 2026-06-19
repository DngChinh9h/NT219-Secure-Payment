"use strict";

const crypto = require("crypto");

const API_BASE_URL = (
  process.env.API_BASE_URL || "http://localhost:10000"
).replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CUSTOMER_EMAIL =
  process.env.E2E_CUSTOMER_EMAIL ||
  `e2e_reconciliation_${Date.now()}@example.com`;
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
  return (typeof value === "string" ? value : JSON.stringify(value, null, 2))
    .replace(/("(?:token|password|authorization)"\s*:\s*")[^"]+(")/gi, "$1[REDACTED]$2")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9._-]+\b/g, "[REDACTED_JWT]");
}

function setStep(step) {
  currentStep = step;
  console.log(`\n[${step}]`);
}

async function request(method, path, { token, body, expectedStatus = 200 } = {}) {
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

  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.status)) {
    fail(`Unexpected HTTP status for ${method} ${path}: ${response.status}`, {
      status: response.status,
      body: parsedBody,
    });
  }

  return { status: response.status, body: parsedBody };
}

async function login(email, password) {
  const { body } = await request("POST", "/api/auth/login", {
    body: { email, password },
  });
  assert(body?.token && body?.user, "Login response is incomplete", body);
  return body;
}

async function registerCustomer() {
  const registration = await request("POST", "/api/auth/register", {
    body: {
      email: CUSTOMER_EMAIL,
      password: CUSTOMER_PASSWORD,
      fullName: "Reconciliation E2E Customer",
      address: "Reconciliation E2E Address",
      cccdNumber: "999999999995",
    },
    expectedStatus: [201, 409],
  });

  if (registration.status === 409) {
    return login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  }

  assert(registration.body?.token, "Registration response is missing token");
  return registration.body;
}

async function createPaidOrder(customerToken) {
  const order = await request("POST", "/api/orders", {
    token: customerToken,
    body: {
      items: [
        {
          productId: SEEDED_PRODUCT_ID,
          quantity: 1,
        },
      ],
      shippingAddress: "Reconciliation E2E Address",
    },
    expectedStatus: 201,
  });
  const orderId = order.body?.order?.id;
  assert(orderId, "Create order response is missing order.id", order.body);

  const payment = await request("POST", "/api/payments/create-intent", {
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
  assert(payment.body?.status === "succeeded", "MockBank payment failed", payment.body);
  return orderId;
}

async function createRefundRequest(customerToken, orderId, expectedStatus = 201) {
  return request("POST", "/api/refund-requests", {
    token: customerToken,
    body: {
      orderId,
      reason: "requested_by_customer",
      details: "Reconciliation E2E refund request",
    },
    expectedStatus,
  });
}

async function run() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    fail("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required");
  }

  console.log(`E2E reconciliation target: ${API_BASE_URL}`);
  console.log(`E2E customer email: ${CUSTOMER_EMAIL}`);

  setStep("health");
  const health = await request("GET", "/health");
  serverTimestamp = health.body?.time ? Date.parse(health.body.time) : Date.now();
  pass("health");

  setStep("login and customer setup");
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert(admin.user.role === "admin", "Admin login did not return admin role");
  const customer = await registerCustomer();
  assert(customer.user?.role === "customer", "Customer setup did not return customer role");
  pass("login and customer setup");

  setStep("admin-only access");
  await request("GET", "/api/admin/security/reconciliation", {
    token: customer.token,
    expectedStatus: 403,
  });
  await request("GET", "/api/admin/security/risk-evidence", {
    token: customer.token,
    expectedStatus: 403,
  });
  pass("admin-only access");

  setStep("paid and refunded flow");
  const orderId = await createPaidOrder(customer.token);
  const refund = await createRefundRequest(customer.token, orderId);
  const refundRequestId = refund.body?.refundRequest?.id;
  assert(refundRequestId, "Refund request response is missing id", refund.body);
  await createRefundRequest(customer.token, orderId, [400, 409]);
  await request("POST", `/api/admin/refund-requests/${refundRequestId}/approve`, {
    token: admin.token,
  });
  await request("POST", `/api/admin/refund-requests/${refundRequestId}/approve`, {
    token: admin.token,
    expectedStatus: [400, 409],
  });
  pass("paid and refunded flow");

  setStep("reconciliation");
  const reconciliation = await request("GET", "/api/admin/security/reconciliation", {
    token: admin.token,
  });
  assert(
    Array.isArray(reconciliation.body?.mismatches),
    "Reconciliation response is missing mismatches",
    reconciliation.body,
  );
  assert(
    !reconciliation.body.mismatches.some((mismatch) => mismatch.orderId === orderId),
    "Generated refunded flow has a reconciliation mismatch",
    reconciliation.body,
  );
  assert(reconciliation.body.refundedOrders >= 1, "Refunded order count is missing");
  assert(reconciliation.body.refundedTransactions >= 1, "Refunded transaction count is missing");
  assert(reconciliation.body.providerLinkedRefunds >= 1, "Provider-linked refund count is missing");
  pass("reconciliation");

  setStep("risk evidence");
  const risk = await request("GET", "/api/admin/security/risk-evidence", {
    token: admin.token,
  });
  assert(risk.body?.rules?.duplicatePaymentAttemptsBlocked?.enabled === true, "Duplicate payment rule missing", risk.body);
  assert(risk.body?.rules?.duplicateRefundAttemptsBlocked?.enabled === true, "Duplicate refund rule missing", risk.body);
  assert(risk.body?.rules?.replayAttemptsBlocked?.enabled === true, "Replay rule missing", risk.body);
  assert(
    risk.body.rules.duplicateRefundAttemptsBlocked.observedCount >= 1,
    "Generated duplicate refund evidence was not observed",
    risk.body,
  );
  pass("risk evidence");

  console.log("\nE2E Reconciliation Summary:");
  for (const line of summary) console.log(line);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("\nE2E Reconciliation FAILED");
    console.error(`Step: ${err.step || currentStep}`);
    console.error(err.message);
    if (err.details !== undefined) console.error(redact(err.details));
    process.exitCode = 1;
  });
