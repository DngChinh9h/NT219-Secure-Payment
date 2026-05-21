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
      amount:      50000
    });
    const res = mockResponse();
    validate(paymentSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('amount âm → 400', () => {
    const req = mockRequest({
      orderId:     '550e8400-e29b-41d4-a716-446655440000',
      stripeToken: 'pm_test_123',
      amount:      -100
    });
    const res = mockResponse();
    validate(paymentSchema)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});