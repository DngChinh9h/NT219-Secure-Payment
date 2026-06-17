"use strict";

const {
  checkVelocity,
  recordFailure,
  resetVelocityForTest,
} = require("../velocityCheck");

describe("velocityCheck", () => {
  const testUserId = "test-user-velocity-123";

  beforeEach(() => {
    resetVelocityForTest(testUserId);
  });

  test("ban đầu không block", () => {
    const result = checkVelocity(testUserId);
    expect(result.blocked).toBe(false);
  });

  test("1 lần fail → không block", () => {
    recordFailure(testUserId);
    const result = checkVelocity(testUserId);
    expect(result.blocked).toBe(false);
  });

  test("2 lần fail → không block", () => {
    recordFailure(testUserId);
    recordFailure(testUserId);
    const result = checkVelocity(testUserId);
    expect(result.blocked).toBe(false);
  });

  test("recordFailure 3 lần → lần tiếp theo block", () => {
    recordFailure(testUserId);
    recordFailure(testUserId);
    recordFailure(testUserId);

    const result = checkVelocity(testUserId);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Too many failed payment attempts");
  });

  test("resetVelocityForTest xóa trạng thái test", () => {
    recordFailure(testUserId);
    recordFailure(testUserId);
    recordFailure(testUserId);

    // Should be blocked
    expect(checkVelocity(testUserId).blocked).toBe(true);

    // Reset
    resetVelocityForTest(testUserId);

    // Should no longer be blocked
    expect(checkVelocity(testUserId).blocked).toBe(false);
  });

  test("different users have independent velocity", () => {
    const otherUser = "other-user-456";
    resetVelocityForTest(otherUser);

    // Block test user
    recordFailure(testUserId);
    recordFailure(testUserId);
    recordFailure(testUserId);

    // Test user blocked
    expect(checkVelocity(testUserId).blocked).toBe(true);

    // Other user NOT blocked
    expect(checkVelocity(otherUser).blocked).toBe(false);

    resetVelocityForTest(otherUser);
  });
});
