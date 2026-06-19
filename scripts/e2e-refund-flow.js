"use strict";

const crypto = require("crypto");

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:10000").replace(
  /\/+$/,
  "",
);
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CUSTOMER_EMAIL =
  process.env.E2E_CUSTOMER_EMAIL ||
  `e2e_customer_${Date.now()}@example.com`;
const CUSTOMER_PASSWORD =
  process.env.E2E_CUSTOMER_PASSWORD || "Password123!";
const TEST_STRIPE_REFUND = process.env.E2E_TEST_STRIPE_REFUND !== "false";
const ORDER_TOTAL = 125000;
const SEEDED_PRODUCT_ID = "dd2cb336-6f7f-5bf3-9015-b2f682a8dae6";

const summary = [];
let serverTimestamp = null;

function fail(message, details) {
  const err = new Error(message);
  if (details) err.details = details;
  throw err;
}

function pass(label) {
  summary.push(`PASS ${label}`);
  console.log(`PASS ${label}`);
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

function normalizeExpectedStatuses(expectedStatus) {
  if (expectedStatus === undefined) return [200];
  return Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
}

async function request(
  method,
  path,
  { token, body, expectedStatus = 200 } = {},
) {
  const url = `${API_BASE_URL}${path}`;
  const headers = {};

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  console.log(`\n${method} ${path}`);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    fail(`Request failed: ${method} ${path}: ${err.message}`);
  }

  console.log(`Status: ${response.status}`);
  const rawBody = await response.text();
  let parsedBody = null;

  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  const expectedStatuses = normalizeExpectedStatuses(expectedStatus);
  if (!expectedStatuses.includes(response.status)) {
    console.error("Unexpected response body:");
    console.error(
      typeof parsedBody === "string"
        ? parsedBody
        : JSON.stringify(parsedBody, null, 2),
    );
    fail(
      `Unexpected HTTP status for ${method} ${path}: expected ${expectedStatuses.join(
        " or ",
      )}, received ${response.status}`,
      { status: response.status, body: parsedBody },
    );
  }

  return { status: response.status, body: parsedBody };
}

async function login(email, password) {
  const { body } = await request("POST", "/api/auth/login", {
    body: { email, password },
    expectedStatus: 200,
  });

  assert(body?.token, `Login response for ${email} is missing token`, body);
  assert(body?.user, `Login response for ${email} is missing user`, body);
  return body;
}

async function registerCustomer(email, password) {
  return request("POST", "/api/auth/register", {
    body: {
      email,
      password,
      fullName: "E2E Customer",
      address: "E2E Test Address",
      cccdNumber: "999999999999",
    },
    expectedStatus: [201, 409],
  });
}

async function createOrder(customerToken, suffix) {
  const { body } = await request("POST", "/api/orders", {
    token: customerToken,
    body: {
      items: [
        {
          productId: SEEDED_PRODUCT_ID,
          quantity: 1,
        },
      ],
      shippingAddress: "E2E Test Address",
    },
    expectedStatus: 201,
  });

  assert(body?.order?.id, "Create order response is missing order.id", body);
  return body.order;
}

async function payOrderMockSuccess(customerToken, orderId, amount) {
  const { body } = await request("POST", "/api/payments/create-intent", {
    token: customerToken,
    body: {
      orderId,
      provider: "mock_bank",
      paymentToken: "mock_success",
      amount,
      nonce: crypto.randomUUID(),
      timestamp: serverTimestamp || Date.now(),
    },
    expectedStatus: 200,
  });

  assert(
    ["succeeded", "success"].includes(body?.status),
    `MockBank payment did not succeed for order ${orderId}`,
    body,
  );
  return body;
}

async function payOrderStripeTest(customerToken, orderId, amount) {
  const { body } = await request("POST", "/api/payments/create-intent", {
    token: customerToken,
    body: {
      orderId,
      provider: "stripe",
      paymentToken: "pm_card_visa",
      amount,
      nonce: crypto.randomUUID(),
      timestamp: serverTimestamp || Date.now(),
    },
    expectedStatus: 200,
  });

  assert(
    body?.paymentIntentId?.startsWith("pi_"),
    `Stripe payment response is missing a PaymentIntent id for order ${orderId}`,
    body,
  );
  return body;
}

async function syncPayment(customerToken, paymentIntentId) {
  return request(
    "POST",
    `/api/payments/sync/${encodeURIComponent(paymentIntentId)}`,
    {
      token: customerToken,
      expectedStatus: 200,
    },
  );
}

async function getOrdersMine(customerToken) {
  const { body } = await request("GET", "/api/orders/mine", {
    token: customerToken,
    expectedStatus: 200,
  });
  return body?.orders || [];
}

async function getTransactionsMine(customerToken) {
  const { body } = await request("GET", "/api/transactions/mine", {
    token: customerToken,
    expectedStatus: 200,
  });
  return body?.transactions || [];
}

async function getReceipt(customerToken, transactionId) {
  return request("GET", `/api/transactions/${transactionId}/receipt`, {
    token: customerToken,
    expectedStatus: 200,
  });
}

async function createRefundRequest(
  customerToken,
  orderId,
  reason,
  details,
  expectedStatus = [200, 201],
) {
  return request("POST", "/api/refund-requests", {
    token: customerToken,
    body: { orderId, reason, details },
    expectedStatus,
  });
}

async function listMyRefundRequests(customerToken) {
  const { body } = await request("GET", "/api/refund-requests/mine", {
    token: customerToken,
    expectedStatus: 200,
  });
  return body?.refundRequests || [];
}

async function cancelRefundRequest(customerToken, refundRequestId) {
  return request("POST", `/api/refund-requests/${refundRequestId}/cancel`, {
    token: customerToken,
    expectedStatus: 200,
  });
}

async function adminListRefundRequests(adminToken) {
  const { body } = await request("GET", "/api/admin/refund-requests", {
    token: adminToken,
    expectedStatus: 200,
  });
  return body?.refundRequests || [];
}

async function adminRejectRefundRequest(
  adminToken,
  refundRequestId,
  adminNote,
  expectedStatus = 200,
) {
  return request(
    "POST",
    `/api/admin/refund-requests/${refundRequestId}/reject`,
    {
      token: adminToken,
      body: adminNote === undefined ? {} : { adminNote },
      expectedStatus,
    },
  );
}

async function adminApproveRefundRequest(
  adminToken,
  refundRequestId,
  expectedStatus = 200,
  mockRefundOutcome,
) {
  return request(
    "POST",
    `/api/admin/refund-requests/${refundRequestId}/approve`,
    {
      token: adminToken,
      body:
        mockRefundOutcome === undefined ? undefined : { mockRefundOutcome },
      expectedStatus,
    },
  );
}

async function createPaidOrder(customerToken, suffix) {
  const order = await createOrder(customerToken, suffix);
  await payOrderMockSuccess(customerToken, order.id, ORDER_TOTAL);
  const orders = await getOrdersMine(customerToken);
  const paidOrder = orders.find((candidate) => candidate.id === order.id);

  assert(paidOrder, `Paid order ${order.id} was not returned by /api/orders/mine`);
  assert(
    paidOrder.status === "paid",
    `Expected order ${order.id} to be paid, received ${paidOrder.status}`,
    paidOrder,
  );

  return paidOrder;
}

async function runStripeRefundFlow(customerToken, adminToken) {
  const order = await createOrder(customerToken, "stripe-refund");
  const payment = await payOrderStripeTest(customerToken, order.id, ORDER_TOTAL);
  const sync = await syncPayment(customerToken, payment.paymentIntentId);

  assert(
    sync.body?.providerStatus === "succeeded",
    "Stripe test PaymentIntent did not reach succeeded status",
    sync.body,
  );

  const refundRequest = await createRefundRequest(
    customerToken,
    order.id,
    "requested_by_customer",
    "E2E Stripe refund request",
  );
  const refundRequestId = refundRequest.body?.refundRequest?.id;
  assert(refundRequestId, "Stripe refund request response is missing id");

  const approval = await adminApproveRefundRequest(adminToken, refundRequestId);
  assert(
    approval.body?.refundRequest?.status === "succeeded",
    "Stripe refund request did not succeed",
    approval.body,
  );
  assert(
    approval.body.refundRequest.admin_decision === "approved" &&
      approval.body.refundRequest.provider_status === "succeeded",
    "Stripe refund response does not separate admin and provider status",
    approval.body,
  );
  assert(
    approval.body.refundRequest.provider_refund_id?.startsWith("re_"),
    "Stripe refund request is missing a Stripe re_ refund id",
    approval.body,
  );

  const transactions = await getTransactionsMine(customerToken);
  const transaction = transactions.find(
    (candidate) => candidate.order_id === order.id,
  );
  assert(
    transaction?.status === "refunded",
    "Stripe refund did not mark transaction refunded",
    transaction,
  );

  const orders = await getOrdersMine(customerToken);
  const refundedOrder = orders.find((candidate) => candidate.id === order.id);
  assert(
    refundedOrder?.status === "refunded",
    "Stripe refund did not mark order refunded",
    refundedOrder,
  );
}

async function runMockRefundOutcomeFlow(
  customerToken,
  adminToken,
  outcome,
  expectedRequestStatus,
  expectedProviderStatus,
) {
  const order = await createPaidOrder(customerToken, `refund-${outcome}`);
  const refundRequest = await createRefundRequest(
    customerToken,
    order.id,
    "requested_by_customer",
    `E2E MockBank ${outcome} refund request`,
  );
  const refundRequestId = refundRequest.body?.refundRequest?.id;
  assert(refundRequestId, `MockBank ${outcome} refund request is missing id`);

  const approval = await adminApproveRefundRequest(
    adminToken,
    refundRequestId,
    200,
    outcome,
  );
  const finalRequest = approval.body?.refundRequest;
  assert(
    finalRequest?.status === expectedRequestStatus,
    `MockBank ${outcome} returned unexpected request status`,
    approval.body,
  );
  assert(
    finalRequest.admin_decision === "approved" &&
      finalRequest.provider_status === expectedProviderStatus,
    `MockBank ${outcome} response does not separate admin and provider status`,
    approval.body,
  );

  const transactions = await getTransactionsMine(customerToken);
  const transaction = transactions.find(
    (candidate) => candidate.order_id === order.id,
  );
  const orders = await getOrdersMine(customerToken);
  const finalOrder = orders.find((candidate) => candidate.id === order.id);

  assert(transaction, `MockBank ${outcome} transaction is missing`);
  assert(finalOrder, `MockBank ${outcome} order is missing`);

  if (expectedProviderStatus === "succeeded") {
    assert(transaction.status === "refunded", "Successful refund did not update transaction");
    assert(finalOrder.status === "refunded", "Successful refund did not update order");
  } else {
    assert(transaction.status === "success", `${outcome} refund changed transaction status`);
    assert(finalOrder.status === "paid", `${outcome} refund changed order status`);
  }
}

async function run() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    fail("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required");
  }

  console.log(`E2E refund flow target: ${API_BASE_URL}`);
  console.log(`E2E customer email: ${CUSTOMER_EMAIL}`);

  const health = await request("GET", "/health", { expectedStatus: 200 });
  serverTimestamp = health.body?.time
    ? Date.parse(health.body.time)
    : Date.now();
  pass("health");

  await request("GET", "/api/config/public", { expectedStatus: [200, 304] });
  pass("public config");

  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert(adminLogin.user.role === "admin", "Admin login did not return admin role");
  const adminToken = adminLogin.token;
  pass("admin login");

  const registration = await registerCustomer(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  if (registration.status === 409) {
    console.log("Customer already exists; continuing with login.");
  }
  const customerLogin = await login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  assert(
    customerLogin.user.role === "customer",
    "Customer login did not return customer role",
  );
  const customerToken = customerLogin.token;
  pass("customer setup");

  const rejectedOrder = await createPaidOrder(customerToken, "reject");
  pass("create paid order");

  const createdRequest = await createRefundRequest(
    customerToken,
    rejectedOrder.id,
    "Duplicate order",
    "E2E refund request",
  );
  const rejectedRequest = createdRequest.body?.refundRequest;
  assert(rejectedRequest?.id, "Create refund request response is missing id");
  assert(
    rejectedRequest.status === "pending_review",
    "Expected pending_review refund request",
    rejectedRequest,
  );
  assert(
    rejectedRequest.admin_decision === "pending" &&
      rejectedRequest.provider_status === "not_started",
    "New refund request does not expose separate admin and provider status",
    rejectedRequest,
  );
  pass("create refund request");

  await createRefundRequest(
    customerToken,
    rejectedOrder.id,
    "Duplicate order",
    "E2E duplicate refund request",
    409,
  );
  pass("duplicate blocked");

  const customerRequests = await listMyRefundRequests(customerToken);
  assert(
    customerRequests.some((candidate) => candidate.id === rejectedRequest.id),
    "Customer refund request is missing from /api/refund-requests/mine",
  );
  pass("customer list own requests");

  await request(
    "POST",
    `/api/admin/refund-requests/${rejectedRequest.id}/reject`,
    {
      token: customerToken,
      body: { adminNote: "Customer must not reject" },
      expectedStatus: 403,
    },
  );
  pass("customer cannot admin reject");

  const adminRequests = await adminListRefundRequests(adminToken);
  assert(
    adminRequests.some((candidate) => candidate.id === rejectedRequest.id),
    "Refund request is missing from admin list",
  );
  pass("admin list");

  const rejection = await adminRejectRefundRequest(
    adminToken,
    rejectedRequest.id,
    "E2E rejection reason",
  );
  assert(rejection.body?.refundRequest?.status === "rejected", "Admin reject failed");
  assert(
    rejection.body.refundRequest.admin_decision === "rejected" &&
      rejection.body.refundRequest.provider_status === "not_started",
    "Rejected refund request does not expose separate admin and provider status",
    rejection.body,
  );
  assert(
    rejection.body.refundRequest.admin_note ||
      rejection.body.refundRequest.adminNote,
    "Admin rejection response is missing admin note",
  );
  pass("admin reject");

  const noteOrder = await createPaidOrder(customerToken, "reject-note");
  const noteRequest = await createRefundRequest(
    customerToken,
    noteOrder.id,
    "Duplicate order",
    "E2E reject note validation",
  );
  await adminRejectRefundRequest(
    adminToken,
    noteRequest.body.refundRequest.id,
    undefined,
    400,
  );
  pass("reject without note blocked");

  const approvedOrder = await createPaidOrder(customerToken, "approve");
  const approvedRequest = await createRefundRequest(
    customerToken,
    approvedOrder.id,
    "Duplicate order",
    "E2E approval request",
  );
  const approvedRequestId = approvedRequest.body.refundRequest.id;
  const approval = await adminApproveRefundRequest(adminToken, approvedRequestId);
  const finalRequest = approval.body?.refundRequest;

  assert(
    finalRequest?.status === "succeeded",
    "Default MockBank admin approval did not succeed",
    approval.body,
  );
  assert(
    finalRequest.admin_decision === "approved" &&
      finalRequest.provider_status === "succeeded",
    "Default MockBank response does not separate admin and provider status",
    approval.body,
  );

  assert(
    finalRequest.provider_refund_id ||
      approval.body?.refund?.refundId ||
      approval.body?.refund?.transaction?.refund_id,
    "Successful approval is missing provider refund metadata",
    approval.body,
  );

  const transactions = await getTransactionsMine(customerToken);
  const refundedTransaction = transactions.find(
    (candidate) => candidate.order_id === approvedOrder.id,
  );
  assert(
    refundedTransaction?.status === "refunded",
    "Successful approval did not refund transaction",
    refundedTransaction,
  );
  await getReceipt(customerToken, refundedTransaction.id);
  pass(`admin approve / provider result: ${finalRequest.status}`);

  await adminApproveRefundRequest(adminToken, approvedRequestId, [400, 409]);
  pass("duplicate approve blocked");

  await runMockRefundOutcomeFlow(
    customerToken,
    adminToken,
    "pending",
    "approved_processing",
    "pending",
  );
  pass("mock refund pending");

  await runMockRefundOutcomeFlow(
    customerToken,
    adminToken,
    "failed",
    "provider_failed",
    "failed",
  );
  pass("mock refund failed");

  const unpaidOrder = await createOrder(customerToken, "unpaid");
  const unpaidAttempt = await createRefundRequest(
    customerToken,
    unpaidOrder.id,
    "Duplicate order",
    "E2E unpaid refund request",
    [400, 409],
  );
  assert(
    /paid/i.test(unpaidAttempt.body?.error || ""),
    "Unpaid refund rejection did not explain paid-order requirement",
    unpaidAttempt.body,
  );
  pass("unpaid order blocked");

  if (TEST_STRIPE_REFUND) {
    await runStripeRefundFlow(customerToken, adminToken);
    pass("opt-in Stripe refund");
  }

  // Keep this helper exercised and available for follow-up smoke extensions.
  void cancelRefundRequest;

  console.log("\nE2E Refund Flow Summary:");
  for (const line of summary) console.log(line);
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("\nE2E Refund Flow FAILED");
    console.error(err.message);
    if (err.details) {
      console.error(JSON.stringify(err.details, null, 2));
    }
    process.exitCode = 1;
  });

module.exports = {
  adminApproveRefundRequest,
  adminListRefundRequests,
  adminRejectRefundRequest,
  cancelRefundRequest,
  createOrder,
  createRefundRequest,
  getOrdersMine,
  getReceipt,
  getTransactionsMine,
  login,
  payOrderMockSuccess,
  payOrderStripeTest,
  registerCustomer,
  request,
  runMockRefundOutcomeFlow,
  runStripeRefundFlow,
  syncPayment,
};
