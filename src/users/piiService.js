'use strict';
    const { aesEncrypt, aesDecrypt } = require('../crypto');
    const { generateDataKey, unwrapDataKey } = require('../kms/kmsService');
    
    /**
     * Mã hóa PII của user trước khi lưu DB
     * Gọi trong createUser() sau khi có userId
     *
     * @param {{ fullName, address, cccdNumber }} pii
     * @returns DB-ready fields (tất cả string hex)
     */
    function encryptUserPII({ fullName, address, cccdNumber }) {
      const { plaintext: dataKey, wrapped } = generateDataKey();
    
      const encName    = aesEncrypt(fullName,    dataKey);
      const encAddress = aesEncrypt(address,     dataKey);
      const encCCCD    = aesEncrypt(cccdNumber,  dataKey);
    
      // Xóa dataKey khỏi memory ngay sau khi dùng
      dataKey.fill(0);
    
      return {
        encrypted_name:     encName.ciphertext,
        name_iv:            encName.iv,
        name_auth_tag:      encName.authTag,
    
        encrypted_address:  encAddress.ciphertext,
        address_iv:         encAddress.iv,
        address_auth_tag:   encAddress.authTag,
    
        encrypted_cccd:     encCCCD.ciphertext,
        cccd_iv:            encCCCD.iv,
        cccd_auth_tag:      encCCCD.authTag,
    
        wrapped_data_key:   wrapped
      };
    }
    
    /**
     * Giải mã PII từ DB để hiển thị
     * Gọi trong getProfile()
     *
     * @param {object} userRow — row từ DB
     * @returns {{ fullName, address, cccdNumber }}
     */
    function decryptUserPII(userRow) {
      const dataKey = unwrapDataKey(userRow.wrapped_data_key);
    
      const fullName   = aesDecrypt({
        ciphertext: userRow.encrypted_name,
        iv:         userRow.name_iv,
        authTag:    userRow.name_auth_tag
      }, dataKey);
    
      const address    = aesDecrypt({
        ciphertext: userRow.encrypted_address,
        iv:         userRow.address_iv,
        authTag:    userRow.address_auth_tag
      }, dataKey);
    
      const cccdNumber = aesDecrypt({
        ciphertext: userRow.encrypted_cccd,
        iv:         userRow.cccd_iv,
        authTag:    userRow.cccd_auth_tag
      }, dataKey);
    
      dataKey.fill(0); // Xóa key khỏi memory
      return { fullName, address, cccdNumber };
    }
    
    module.exports = { encryptUserPII, decryptUserPII };