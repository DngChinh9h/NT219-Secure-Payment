const { validateNonce, _clearNonces } = require('../nonceValidator');

beforeEach(() => _clearNonces());

describe('Nonce Validator', () => {
  test('nonce mới + timestamp hợp lệ → { valid: true }', () => {
    const result = validateNonce('unique-nonce-001', Date.now());
    expect(result.valid).toBe(true);
  });

  test('cùng nonce 2 lần → replay detected', () => {
    validateNonce('nonce-replay', Date.now());
    const second = validateNonce('nonce-replay', Date.now());
    expect(second.valid).toBe(false);
    expect(second.reason).toContain('Replay attack');
  });

  test('timestamp quá cũ (>5 phút) → expired', () => {
    const oldTimestamp = Date.now() - 6 * 60 * 1000;
    const result = validateNonce('nonce-old', oldTimestamp);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });

  test('timestamp trong tương lai (>5 phút) → expired', () => {
    const futureTimestamp = Date.now() + 6 * 60 * 1000;
    const result = validateNonce('nonce-future', futureTimestamp);
    expect(result.valid).toBe(false);
  });

  test('thiếu nonce → invalid', () => {
    expect(validateNonce(null, Date.now()).valid).toBe(false);
  });

  test('thiếu timestamp → invalid', () => {
    expect(validateNonce('nonce-123', null).valid).toBe(false);
  });

  test('2 nonce khác nhau đều hợp lệ', () => {
    expect(validateNonce('nonce-A', Date.now()).valid).toBe(true);
    expect(validateNonce('nonce-B', Date.now()).valid).toBe(true);
  });
});