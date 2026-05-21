const { signJWT, verifyJWT } = require('../jwtHelper');

describe('JWT RS256 Helper', () => {
  const testPayload = { userId: 'user-123', email: 'a@b.com', role: 'customer' };

  test('sign rồi verify → decode đúng payload', () => {
    const token   = signJWT(testPayload);
    const decoded = verifyJWT(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.email).toBe('a@b.com');
    expect(decoded.role).toBe('customer');
  });

  test('token giả → throw JsonWebTokenError', () => {
    expect(() => verifyJWT('invalid.token.here')).toThrow();
  });

  test('alg:none bị chặn → throw Error', () => {
    const payload  = Buffer.from(JSON.stringify(testPayload)).toString('base64url');
    const header   = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const fakeToken = `${header}.${payload}.`;
    expect(() => verifyJWT(fakeToken)).toThrow();
  });

  test('token có đủ fields cần thiết', () => {
    const token   = signJWT(testPayload);
    const decoded = verifyJWT(token);
    expect(decoded).toHaveProperty('iat');
    expect(decoded).toHaveProperty('exp');
    expect(decoded).toHaveProperty('iss');
  });
});