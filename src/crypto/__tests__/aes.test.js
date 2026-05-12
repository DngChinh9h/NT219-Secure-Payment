const crypto = require('crypto');

process.env.AES_KEY = crypto.randomBytes(32).toString('hex');

const { aesEncrypt, aesDecrypt } = require('../aesHelper');

describe('AES Helper', () => {
  test('encrypt decrypt', () => {
    const original = '4111111111111111';
    const encrypted = aesEncrypt(original);
    expect(aesDecrypt(encrypted)).toBe(original);
  });

  test('unique iv', () => {
    const e1 = aesEncrypt('test');
    const e2 = aesEncrypt('test');
    expect(e1.iv).not.toBe(e2.iv);
  });

  test('invalid authTag', () => {
    const enc = aesEncrypt('sensitive data');
    enc.authTag = 'a'.repeat(32);
    expect(() => aesDecrypt(enc)).toThrow();
  });
});