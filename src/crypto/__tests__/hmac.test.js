process.env.HMAC_SECRET = 'test-secret-32-chars-minimum!!!x';
const { hmacSign, hmacVerify } = require('../hmacHelper');

describe('HMAC Helper', () => {
  test('sign tạo ra hex string', () => {
    const sig = hmacSign({ amount: 100 });
    expect(typeof sig).toBe('string');
    expect(sig.length).toBe(64);
    expect(sig).toMatch(/^[a-f0-9]+$/);
  });

  test('sign object và string tương đương khi stringify', () => {
    const obj = { orderId: 'abc', amount: 100 };
    const sig1 = hmacSign(obj);
    const sig2 = hmacSign(JSON.stringify(obj));
    expect(sig1).toBe(sig2);
  });

  test('verify đúng payload → true', () => {
    const payload = { orderId: 'test-123', amount: 50000, userId: 'u1' };
    const sig = hmacSign(payload);
    expect(hmacVerify(payload, sig)).toBe(true);
  });

  test('payload bị sửa → false', () => {
    const sig = hmacSign({ amount: 100 });
    expect(hmacVerify({ amount: 999 }, sig)).toBe(false);
  });

  test('signature giả → false', () => {
    expect(hmacVerify({ amount: 100 }, 'a'.repeat(64))).toBe(false);
  });

  test('signature sai length → false (không crash)', () => {
    expect(hmacVerify({ amount: 100 }, 'tooshort')).toBe(false);
  });
});