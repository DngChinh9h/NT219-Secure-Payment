"use strict";

const crypto = require("crypto");

// Set KMS_MASTER_KEY before importing piiService
process.env.KMS_MASTER_KEY = crypto.randomBytes(32).toString("hex");

const { encryptUserPII, decryptUserPII } = require("../piiService");

describe("piiService", () => {
  const testPII = {
    fullName: "Nguyễn Văn A",
    address: "123 Đường Lê Lợi, TP.HCM",
    cccdNumber: "079123456789",
  };

  test("encryptUserPII không trả plaintext", () => {
    const encrypted = encryptUserPII(testPII);

    // Encrypted fields should exist
    expect(encrypted.encrypted_name).toBeDefined();
    expect(encrypted.name_iv).toBeDefined();
    expect(encrypted.name_auth_tag).toBeDefined();
    expect(encrypted.encrypted_address).toBeDefined();
    expect(encrypted.address_iv).toBeDefined();
    expect(encrypted.address_auth_tag).toBeDefined();
    expect(encrypted.encrypted_cccd).toBeDefined();
    expect(encrypted.cccd_iv).toBeDefined();
    expect(encrypted.cccd_auth_tag).toBeDefined();
    expect(encrypted.wrapped_data_key).toBeDefined();

    // Plaintext should NOT appear in encrypted output
    expect(encrypted.encrypted_name).not.toBe(testPII.fullName);
    expect(encrypted.encrypted_address).not.toBe(testPII.address);
    expect(encrypted.encrypted_cccd).not.toBe(testPII.cccdNumber);

    // Should not contain plaintext substrings in any encrypted field
    const allValues = Object.values(encrypted).join(" ");
    expect(allValues).not.toContain(testPII.fullName);
    expect(allValues).not.toContain(testPII.address);
    expect(allValues).not.toContain(testPII.cccdNumber);
  });

  test("decryptUserPII trả lại đúng fullName/address/cccd", () => {
    const encrypted = encryptUserPII(testPII);

    const decrypted = decryptUserPII(encrypted);

    expect(decrypted.fullName).toBe(testPII.fullName);
    expect(decrypted.address).toBe(testPII.address);
    expect(decrypted.cccdNumber).toBe(testPII.cccdNumber);
  });

  test("sửa ciphertext → decrypt throw error", () => {
    const encrypted = encryptUserPII(testPII);

    // Tamper with the ciphertext
    encrypted.encrypted_name = "0000" + encrypted.encrypted_name.slice(4);

    expect(() => decryptUserPII(encrypted)).toThrow();
  });

  test("sửa authTag → decrypt throw error", () => {
    const encrypted = encryptUserPII(testPII);

    // Tamper with the auth tag
    encrypted.name_auth_tag = "0000" + encrypted.name_auth_tag.slice(4);

    expect(() => decryptUserPII(encrypted)).toThrow();
  });

  test("mỗi lần encrypt tạo IV khác nhau", () => {
    const enc1 = encryptUserPII(testPII);
    const enc2 = encryptUserPII(testPII);

    // IVs should differ (random each time)
    expect(enc1.name_iv).not.toBe(enc2.name_iv);
    expect(enc1.encrypted_name).not.toBe(enc2.encrypted_name);
  });
});
