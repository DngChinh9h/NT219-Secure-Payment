"use strict";

const crypto = require("crypto");
const { decryptUserPII, encryptUserPII } = require("../piiService");

describe("PII envelope encryption through Security Service", () => {
  const testPii = { fullName: "Nguyen Van A", address: "123 Le Loi, HCMC", cccdNumber: "079123456789" };
  let dataKey;
  let securityClient;

  beforeEach(() => {
    dataKey = null;
    securityClient = {
      wrapKey: jest.fn(async (key) => {
        dataKey = Buffer.from(key);
        return "security-service-wrapped-key";
      }),
      unwrapKey: jest.fn(async () => Buffer.from(dataKey)),
    };
  });

  test("encrypts PII locally with a transient data key and delegates wrapping", async () => {
    const encrypted = await encryptUserPII(testPii, securityClient);
    expect(securityClient.wrapKey).toHaveBeenCalledTimes(1);
    expect(encrypted.wrapped_data_key).toBe("security-service-wrapped-key");
    expect(Object.values(encrypted).join(" ")).not.toContain(testPii.fullName);
    expect(Object.values(encrypted).join(" ")).not.toContain(testPii.address);
    expect(Object.values(encrypted).join(" ")).not.toContain(testPii.cccdNumber);
  });

  test("delegates unwrap before decrypting PII", async () => {
    const encrypted = await encryptUserPII(testPii, securityClient);
    await expect(decryptUserPII(encrypted, securityClient)).resolves.toEqual(testPii);
    expect(securityClient.unwrapKey).toHaveBeenCalledWith("security-service-wrapped-key");
  });

  test.each(["encrypted_name", "name_auth_tag"])("rejects tampered %s", async (field) => {
    const encrypted = await encryptUserPII(testPii, securityClient);
    encrypted[field] = crypto.randomBytes(16).toString("hex");
    await expect(decryptUserPII(encrypted, securityClient)).rejects.toThrow();
  });
});
