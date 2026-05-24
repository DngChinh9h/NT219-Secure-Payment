const crypto = require('crypto');
    process.env.KMS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
    const { generateDataKey, unwrapDataKey } = require('../kmsService');
    
    describe('KMS Service', () => {
      test('generateDataKey trả về plaintext 32 bytes', () => {
        const { plaintext } = generateDataKey();
        expect(plaintext).toBeInstanceOf(Buffer);
        expect(plaintext.length).toBe(32);
      });
    
      test('generateDataKey trả về wrapped string hex', () => {
        const { wrapped } = generateDataKey();
        expect(typeof wrapped).toBe('string');
        expect(wrapped).toMatch(/^[a-f0-9]+$/);
      });
    
      test('unwrapDataKey khôi phục đúng plaintext', () => {
        const { plaintext, wrapped } = generateDataKey();
        const unwrapped = unwrapDataKey(wrapped);
        expect(unwrapped).toBeInstanceOf(Buffer);
        expect(unwrapped.equals(plaintext)).toBe(true);
      });
    
      test('2 lần generateDataKey → 2 plaintext khác nhau', () => {
        const { plaintext: k1 } = generateDataKey();
        const { plaintext: k2 } = generateDataKey();
        expect(k1.equals(k2)).toBe(false);
      });
    
      test('wrapped key sai → unwrap throw Error', () => {
        expect(() => unwrapDataKey('a'.repeat(64))).toThrow();
      });
    });
