const { validate, loginSchema, orderSchema, paymentSchema } = require('../inputValidator');

function mockRequest(body) { return { body }; }
function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('Input Validator — Login Schema', () => {
  test('email và password hợp lệ → gọi next()', () => {
    const req  = mockRequest({ email: 'user@test.com', password: 'Password1' });
    const res  = mockResponse();
    const next = jest.fn();
    validate(loginSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('SQL injection trong email → 400', () => {
    const req  = mockRequest({ email: "' OR '1'='1' --", password: 'pass' });
    const res  = mockResponse();
    validate(loginSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('email sai format → 400', () => {
    const req = mockRequest({ email: 'notanemail', password: 'Password1' });
    const res = mockResponse();
    validate(loginSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('password quá ngắn → 400', () => {
    const req = mockRequest({ email: 'a@b.com', password: '' });
    const res = mockResponse();
    validate(loginSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('Input Validator — Payment Schema', () => {
  test('stripeToken không bắt đầu bằng pm_ → 400', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'tok_visa', 
      amount:      50000,
      nonce:       '550e8400-e29b-41d4-a716-446655440001',
      timestamp:   Date.now()
    });
    const res = mockResponse();
    validate(paymentSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('amount âm → 400', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'pm_test_123',
      amount:      -100,
      nonce:       '550e8400-e29b-41d4-a716-446655440001',
      timestamp:   Date.now()
    });
    const res = mockResponse();
    validate(paymentSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('payment body hợp lệ có nonce, timestamp → next được gọi', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'pm_test_123',
      amount:      50000,
      nonce:       '550e8400-e29b-41d4-a716-446655440001',
      timestamp:   Date.now()
    });
    const res  = mockResponse();
    const next = jest.fn();
    validate(paymentSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    // nonce and timestamp should be preserved in sanitized body
    expect(req.body.nonce).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(req.body.timestamp).toBeDefined();
  });

  test('thiếu nonce → 400', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'pm_test_123',
      amount:      50000,
      timestamp:   Date.now()
    });
    const res = mockResponse();
    validate(paymentSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('thiếu timestamp → 400', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'pm_test_123',
      amount:      50000,
      nonce:       '550e8400-e29b-41d4-a716-446655440001'
    });
    const res = mockResponse();
    validate(paymentSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('timestamp dạng string → coerce thành number, next được gọi', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'pm_test_123',
      amount:      50000,
      nonce:       '550e8400-e29b-41d4-a716-446655440001',
      timestamp:   String(Date.now())
    });
    const res  = mockResponse();
    const next = jest.fn();
    validate(paymentSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(typeof req.body.timestamp).toBe('number');
  });
});