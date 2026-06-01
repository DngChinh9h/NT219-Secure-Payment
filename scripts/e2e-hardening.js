"use strict";

const crypto = require("crypto");

const API_BASE_URL = (
  process.env.API_BASE_URL || "http://localhost:10000"
).replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CUSTOMER_EMAIL =
  process.env.E2E_CUSTOMER_EMAIL ||
  `e2e_hardening_${Date.now()}@example.com`;
const CUSTOMER_PASSWORD =
  process.env.E2E_CUSTOMER_PASSWORD || "Password123!";
const ORDER_TOTAL = 50000;

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
      fullName: "Hardening E2E Customer",
      address: "Hardening E2E Address",
      cccdNumber: "999999999996",
    },
    expectedStatus: [201, 409],
  });

  if (registration.status === 409) {
    return login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  }

  assert(registration.body?.token, "Registration response is missing token");
  return registration.body;
}

async function createOrder(customerToken, suffix) {
  const { body } = await request("POST", "/api/orders", {
    token: customerToken,
    body: {
      items: [
        {
          productId: crypto.randomUUID(),
          productName: `Hardening E2E Item ${suffix}`,
          quantity: 1,
          unitPrice: ORDER_TOTAL,
        },
      ],
      shippingAddress: "Hardening E2E Address",
      totalAmount: ORDER_TOTAL,
    },
    expectedStatus: 201,
  });
  assert(body?.order?.id, "Create order response is missing order.id", body);
  return body.order;
}

async function payMockBank(customerToken, orderId, nonce, timestamp, expectedStatus = 200) {
  return request("POST", "/api/payments/create-intent", {
    token: customerToken,
    body: {
      orderId,
      provider: "mock_bank",
      paymentToken: "mock_success",
      amount: ORDER_TOTAL,
      nonce,
      timestamp,
    },
    expectedStatus,
  });
}

async function createRefundRequest(customerToken, orderId, expectedStatus = 201) {
  return request("POST", "/api/refund-requests", {
    token: customerToken,
    body: {
      orderId,
      reason: "requested_by_customer",
      details: "Hardening E2E refund request",
    },
    expectedStatus,
  });
}

async function run() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    fail("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required");
  }

  console.log(`E2E hardening target: ${API_BASE_URL}`);
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

  setStep("admin hardening access control");
  await request("GET", "/api/admin/security/hardening", {
    token: customer.token,
    expectedStatus: 403,
  });
  const hardening = await request("GET", "/api/admin/security/hardening", {
    token: admin.token,
  });
  assert(hardening.body?.rateLimitEnabled === true, "Rate-limit evidence missing", hardening.body);
  assert(hardening.body?.corsRestricted === true, "CORS evidence missing", hardening.body);
  assert(hardening.body?.securityHeadersEnabled === true, "Header evidence missing", hardening.body);
  assert(hardening.body?.replayProtectionEnabled === true, "Replay evidence missing", hardening.body);
  pass("admin hardening access control");

  setStep("replay duplicate blocked");
  const paidOrder = await createOrder(customer.token, "paid");
  const replayOrder = await createOrder(customer.token, "replay");
  const nonce = crypto.randomUUID();
  const timestamp = serverTimestamp;
  const payment = await payMockBank(customer.token, paidOrder.id, nonce, timestamp);
  assert(payment.body?.status === "succeeded", "Initial MockBank payment failed", payment.body);
  const replay = await payMockBank(customer.token, replayOrder.id, nonce, timestamp, [400, 409]);
  assert(/replay|nonce/i.test(replay.body?.error || ""), "Replay block reason is unclear", replay.body);
  pass("replay duplicate blocked");

  setStep("double payment blocked");
  await payMockBank(
    customer.token,
    paidOrder.id,
    crypto.randomUUID(),
    serverTimestamp,
    [400, 409],
  );
  pass("double payment blocked");

  setStep("duplicate refund request blocked");
  const refund = await createRefundRequest(customer.token, paidOrder.id);
  const refundRequestId = refund.body?.refundRequest?.id;
  assert(refundRequestId, "Refund request response is missing id", refund.body);
  await createRefundRequest(customer.token, paidOrder.id, [400, 409]);
  pass("duplicate refund request blocked");

  setStep("duplicate approve blocked");
  await request("POST", `/api/admin/refund-requests/${refundRequestId}/approve`, {
    token: admin.token,
  });
  await request("POST", `/api/admin/refund-requests/${refundRequestId}/approve`, {
    token: admin.token,
    expectedStatus: [400, 409],
  });
  pass("duplicate approve blocked");

  console.log("\nE2E Hardening Summary:");
  for (const line of summary) console.log(line);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("\nE2E Hardening FAILED");
    console.error(`Step: ${err.step || currentStep}`);
    console.error(err.message);
    if (err.details !== undefined) console.error(redact(err.details));
    process.exitCode = 1;
  });
