"use strict";

const crypto = require("crypto");
const { aesDecrypt, aesEncrypt } = require("../crypto/aesHelper");
const { getSecurityServiceClient } = require("../security/securityServiceClient");

async function encryptUserPII({ fullName, address, cccdNumber }, securityClient = getSecurityServiceClient()) {
  const dataKey = crypto.randomBytes(32);
  try {
    const wrappedDataKey = await securityClient.wrapKey(dataKey);
    const encName = aesEncrypt(fullName, dataKey);
    const encAddress = aesEncrypt(address, dataKey);
    const encCccd = aesEncrypt(cccdNumber, dataKey);
    return {
      encrypted_name: encName.ciphertext,
      name_iv: encName.iv,
      name_auth_tag: encName.authTag,
      encrypted_address: encAddress.ciphertext,
      address_iv: encAddress.iv,
      address_auth_tag: encAddress.authTag,
      encrypted_cccd: encCccd.ciphertext,
      cccd_iv: encCccd.iv,
      cccd_auth_tag: encCccd.authTag,
      wrapped_data_key: wrappedDataKey,
    };
  } finally {
    dataKey.fill(0);
  }
}

async function decryptUserPII(userRow, securityClient = getSecurityServiceClient()) {
  const dataKey = await securityClient.unwrapKey(userRow.wrapped_data_key);
  try {
    return {
      fullName: aesDecrypt({ ciphertext: userRow.encrypted_name, iv: userRow.name_iv, authTag: userRow.name_auth_tag }, dataKey),
      address: aesDecrypt({ ciphertext: userRow.encrypted_address, iv: userRow.address_iv, authTag: userRow.address_auth_tag }, dataKey),
      cccdNumber: aesDecrypt({ ciphertext: userRow.encrypted_cccd, iv: userRow.cccd_iv, authTag: userRow.cccd_auth_tag }, dataKey),
    };
  } finally {
    dataKey.fill(0);
  }
}

module.exports = { decryptUserPII, encryptUserPII };
