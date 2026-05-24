'use strict';
    
    const WINDOW_MS  = 5 * 60 * 1000; // 5 phút
    const usedNonces = new Set();      // In-memory — production dùng Redis
    
    /**
     * Validate nonce + timestamp của request thanh toán
     * Gọi trong Payment Service trước khi xử lý
     *
     * @param {string} nonce     — UUID random từ client, dùng 1 lần duy nhất
     * @param {number} timestamp — Date.now() từ client (milliseconds)
     * @returns {{ valid: boolean, reason?: string }}
     */
    function validateNonce(nonce, timestamp) {
      // 1. Kiểm tra tồn tại
      if (!nonce || !timestamp) {
        return { valid: false, reason: 'Missing nonce or timestamp' };
      }
    
      // 2. Kiểm tra timestamp — request không quá 5 phút
      const drift = Math.abs(Date.now() - Number(timestamp));
      if (drift > WINDOW_MS) {
        return { valid: false, reason: `Request expired: drift ${drift}ms > ${WINDOW_MS}ms` };
      }
    
      // 3. Kiểm tra nonce chưa được dùng
      if (usedNonces.has(nonce)) {
        return { valid: false, reason: 'Replay attack detected: nonce already used' };
      }
    
      // 4. Ghi nhận nonce đã dùng
      usedNonces.add(nonce);
    
      // 5. Tự dọn sau 5 phút để tránh memory leak
      setTimeout(() => usedNonces.delete(nonce), WINDOW_MS + 1000);
    
      return { valid: true };
    }
    
    // Chỉ dùng cho testing — reset Set
    function _clearNonces() { usedNonces.clear(); }
    
    module.exports = { validateNonce, _clearNonces };