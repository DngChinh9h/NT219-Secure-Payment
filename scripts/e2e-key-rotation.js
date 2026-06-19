"use strict";

const crypto = require("crypto");

const API_BASE_URL = (
  process.env.API_BASE_URL || "http://localhost:10000"
).replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CUSTOMER_EMAIL =
  process.env.E2E_CUSTOMER_EMAIL ||
  `e2e_key_rotation_${Date.now()}@example.com`;
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

  return parsedBody;
}

async function login(email, password) {
  const body = await request("POST", "/api/auth/login", {
    body: { email, password },
  });
  assert(body?.token && body?.user, "Login response is incomplete", body);
  return body;
}

async function registerCustomer() {
  const body = await request("POST", "/api/auth/register", {
    body: {
      email: CUSTOMER_EMAIL,
      password: CUSTOMER_PASSWORD,
      fullName: "Key Rotation E2E Customer",
      address: "Key Rotation E2E Address",
      cccdNumber: "999999999997",
    },
    expectedStatus: [201, 409],
  });
  if (!body?.token) return login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);

  assert(body?.token && body?.user?.role === "customer", "Customer setup failed", body);
  return body;
}

async function createPaidReceipt(customerToken) {
  const orderBody = await request("POST", "/api/orders", {
    token: customerToken,
    body: {
      items: [
        {
          productId: SEEDED_PRODUCT_ID,
          quantity: 1,
        },
      ],
      shippingAddress: "Key Rotation E2E Address",
    },
    expectedStatus: 201,
  });
  const orderId = orderBody?.order?.id;
  assert(orderId, "Create order response is missing order.id", orderBody);

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
  assert(payment?.status === "succeeded", "MockBank payment did not succeed", payment);

  const transactions = await request("GET", "/api/transactions/mine", {
    token: customerToken,
  });
  const transaction = transactions?.transactions?.find(
    (candidate) => candidate.order_id === orderId,
  );
  assert(transaction?.id, "Paid transaction is missing", transactions);

  const receiptBody = await request(
    "GET",
    `/api/transactions/${transaction.id}/receipt`,
    { token: customerToken },
  );
  assert(receiptBody?.receipt, "Receipt is missing", receiptBody);
  return receiptBody.receipt;
}

function decodeReceipt(receipt) {
  const parts = receipt.split(".");
  assert(parts.length === 3, "Receipt is not a three-part JWS");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function tamperReceipt(receipt) {
  const parts = receipt.split(".");
  const payload = decodeReceipt(receipt);
  payload.amount = Number(payload.amount) + 1;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return parts.join(".");
}

async function assertReceiptValid(receipt, expected) {
  const body = await request("POST", "/api/transactions/receipt/verify", {
    body: { receipt },
  });
  assert(body?.valid === expected, `Receipt valid=${expected} assertion failed`, body);
}

async function run() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    fail("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required");
  }

  console.log(`E2E key rotation target: ${API_BASE_URL}`);
  console.log(`E2E customer email: ${CUSTOMER_EMAIL}`);

  setStep("health");
  const health = await request("GET", "/health");
  serverTimestamp = health?.time ? Date.parse(health.time) : Date.now();
  pass("health");

  setStep("admin login");
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert(admin.user.role === "admin", "Admin login did not return admin role");
  pass("admin login");

  setStep("customer setup");
  const customer = await registerCustomer();
  pass("customer setup");

  setStep("receipt A");
  const receiptA = await createPaidReceipt(customer.token);
  await assertReceiptValid(receiptA, true);
  const payloadA = decodeReceipt(receiptA);
  assert(Number.isInteger(payloadA.key_version), "Receipt A is missing key_version", payloadA);
  pass("receipt A verified");

  setStep("rotate key");
  const before = await request("GET", "/api/admin/security/keys/status", {
    token: admin.token,
  });
  const rotated = await request("POST", "/api/admin/security/keys/rotate", {
    token: admin.token,
  });
  assert(
    rotated?.activeKeyVersion > before?.activeKeyVersion,
    "Active key version did not advance",
    { before, rotated },
  );
  assert(
    !/private|encrypted_private|wrapped_data_key/i.test(JSON.stringify(rotated)),
    "Rotation response exposed private key material",
    rotated,
  );
  pass("key rotated");

  setStep("receipt B");
  const receiptB = await createPaidReceipt(customer.token);
  await assertReceiptValid(receiptB, true);
  const payloadB = decodeReceipt(receiptB);
  assert(Number.isInteger(payloadB.key_version), "Receipt B is missing key_version", payloadB);
  assert(
    payloadA.key_version !== payloadB.key_version,
    "Receipts A and B use the same key_version",
    { receiptAKeyVersion: payloadA.key_version, receiptBKeyVersion: payloadB.key_version },
  );
  pass("receipt B uses rotated key");

  setStep("legacy receipt remains valid");
  await assertReceiptValid(receiptA, true);
  pass("receipt A remains valid");

  setStep("tampered receipt");
  await assertReceiptValid(tamperReceipt(receiptA), false);
  pass("tampered receipt rejected");

  console.log("\nE2E Key Rotation Summary:");
  for (const line of summary) console.log(line);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("\nE2E Key Rotation FAILED");
    console.error(`Step: ${err.step || currentStep}`);
    console.error(err.message);
    if (err.details !== undefined) console.error(redact(err.details));
    process.exitCode = 1;
  });
