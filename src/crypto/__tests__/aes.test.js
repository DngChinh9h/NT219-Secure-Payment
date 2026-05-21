const crypto = require('crypto');
const { aesEncrypt, aesDecrypt } = require('../aesHelper');

const testKey = crypto.randomBytes(32);

describe('AES Helper', () => {
  test('encrypt rồi decrypt ra đúng plaintext', () => {
    const original = 'Nguyễn Văn A, 123 Lê Lợi, TP.HCM';
    const encrypted = aesEncrypt(original, testKey);
    expect(aesDecrypt(encrypted, testKey)).toBe(original);
  });

  test('2 lần encrypt cùng plaintext → IV khác nhau', () => {
    const e1 = aesEncrypt('test data', testKey);
    const e2 = aesEncrypt('test data', testKey);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
  });

  test('authTag bị sửa → throw Error (tamper detection)', () => {
    const enc = aesEncrypt('sensitive PII data', testKey);
    const tampered = { ...enc, authTag: 'a'.repeat(32) };
    expect(() => aesDecrypt(tampered, testKey)).toThrow();
  });

  test('ciphertext bị sửa → throw Error', () => {
    const enc = aesEncrypt('important data', testKey);
    const tampered = { ...enc, ciphertext: enc.ciphertext.replace('a', 'b') };
    expect(() => aesDecrypt(tampered, testKey)).toThrow();
  });

  test('key sai → throw Error', () => {
    const enc = aesEncrypt('data', testKey);
    const wrongKey = crypto.randomBytes(32);
    expect(() => aesDecrypt(enc, wrongKey)).toThrow();
  });

  test('key không phải 32 bytes → throw Error', () => {
    expect(() => aesEncrypt('data', Buffer.from('tooshort'))).toThrow();
  });

  test('mã hóa string Unicode (tiếng Việt)', () => {
    const viet = 'Trần Thị Bình, Quận 1, TP Hồ Chí Minh';
    expect(aesDecrypt(aesEncrypt(viet, testKey), testKey)).toBe(viet);
  });
});