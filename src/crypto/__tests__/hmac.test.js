process.env.HMAC_SECRET = 'test-secret-key';

const { hmacSign, hmacVerify } = require('../hmacHelper');

describe('HMAC Helper', () => {
  test('sign', () => {
    const sig = hmacSign({ amount: 100 });
    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^[a-f0-9]+$/);
  });

  test('verify true', () => {
    const payload = { orderId: 'abc', amount: 100 };
    const sig = hmacSign(payload);
    expect(hmacVerify(payload, sig)).toBe(true);
  });

  test('verify false modified', () => {
    const sig = hmacSign({ amount: 100 });
    expect(hmacVerify({ amount: 999 }, sig)).toBe(false);
  });

  test('verify false fake', () => {
    expect(hmacVerify({ amount: 100 }, 'fakesignature')).toBe(false);
  });
});