const userService = require('../userService');
const db = require('../../db');
const { generateDataKey, unwrapDataKey } = require('../../kms/kmsService');
const { aesEncrypt, aesDecrypt } = require('../../crypto');

jest.mock('../../db', () => ({
  query: jest.fn()
}));

jest.mock('../../kms/kmsService', () => ({
  generateDataKey: jest.fn(),
  unwrapDataKey: jest.fn()
}));

jest.mock('../../crypto', () => ({
  aesEncrypt: jest.fn(),
  aesDecrypt: jest.fn()
}));

describe('User Service — Envelope Encryption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createUser mã hóa dữ liệu PII thành công', async () => {
    generateDataKey.mockReturnValue({ plaintext: Buffer.alloc(32), wrapped: 'wrappedhex' });
    aesEncrypt.mockReturnValue({ ciphertext: 'enc', iv: 'iv', authTag: 'tag' });
    db.query.mockResolvedValue({ rows: [{ id: 'uid', email: 'test@test.com', role: 'customer' }] });

    const result = await userService.createUser({
      email: 'test@test.com',
      password: 'password',
      fullName: 'John Doe',
      address: 'USA',
      cccdNumber: '12345'
    });

    expect(result.id).toBe('uid');
    expect(generateDataKey).toHaveBeenCalled();
    expect(aesEncrypt).toHaveBeenCalledTimes(3);
  });

  test('findById giải mã dữ liệu PII thành công', async () => {
    db.query.mockResolvedValue({
      rows: [{
        id: 'uid',
        email: 'test@test.com',
        wrapped_data_key: 'wrappedhex',
        encrypted_name: 'enc',
        name_iv: 'iv',
        name_auth_tag: 'tag'
      }]
    });
    unwrapDataKey.mockReturnValue(Buffer.alloc(32));
    aesDecrypt.mockReturnValue('John Doe');

    const user = await userService.findById('uid');

    expect(user.fullName).toBe('John Doe');
    expect(user.encrypted_name).toBeUndefined();
  });
});