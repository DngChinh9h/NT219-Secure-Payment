# Kịch bản Demo — 5 phút

## Chuẩn bị trước khi demo
1. Chạy `docker compose up` — đảm bảo DB và app đang chạy
2. Chạy `stripe listen --forward-to localhost:3000/api/payments/webhook` — terminal riêng
3. Kiểm tra API: http://localhost:3000/ và http://localhost:3000/health
4. Mở Postman với collection đã chuẩn bị

---

## Phần 1: Luồng chính (2 phút)

**Bước 1 — Đăng nhập:**
> "Hệ thống sử dụng JWT RS256. Private key chỉ Auth Service giữ,
> public key dùng để verify — không thể giả mạo JWT dù biết public key."

- Nhập email/password → nhận JWT
- Mở DevTools → Network → thấy token trong response

**Bước 2 — Tạo đơn hàng:**
> "Order ID được tạo bằng UUID — không thể enumerate ID của người khác."

- Tạo đơn → thấy UUID trong response

**Bước 3 — Thanh toán:**
> "Stripe.js chạy trên browser. Số thẻ gửi thẳng đến Stripe — server
> của chúng tôi chỉ nhận token pm_xxx, không bao giờ thấy số thẻ thật.
> Đây là yêu cầu của chuẩn PCI-DSS."

- Nhập thẻ 4242 4242 4242 4242 → thanh toán → thấy webhook confirm trong terminal Stripe CLI

**Bước 4 — Xem transaction log:**
- Gọi GET /api/transactions/mine → thấy log được HMAC-signed

---

## Phần 2: Demo bảo mật (3 phút — 5 attack cases)

**Attack 1 — Không có JWT:**
```
GET /api/orders/mine  (không có Authorization header)
→ 401 Unauthorized
```

> "Mọi request đến App Zone đều phải qua Gateway middleware verify JWT."

**Attack 2 — JWT với alg:none:**
```
Authorization: Bearer eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJhZG1pbiJ9.
→ 401 Unauthorized
```

> "jwtHelper ràng buộc algorithms: ['RS256']. alg:none bị chặn hoàn toàn."

**Attack 3 — IDOR (truy cập order của người khác):**
```
GET /api/orders/{order_id_của_user_khác}  (dùng JWT của user1)
→ 403 Forbidden
```

> "Authorization Guard kiểm tra order.userId === req.userId.
> Authentication và Authorization là 2 lớp khác nhau."

**Attack 4 — SQL Injection:**
```
POST /api/auth/login
Body: { "email": "' OR '1'='1' --", "password": "any" }
→ 400 Bad Request (Zod reject trước khi chạm DB)
```

> "Zod schema validate email format trước. Kể cả qua Zod,
> parameterized query cũng chặn SQL injection hoàn toàn."

**Attack 5 — Fake Webhook:**
```
POST /api/payments/webhook
Body: { "type": "payment_intent.succeeded", ... }
(không có Stripe-Signature header)
→ 400 Bad Request
```

> "stripe.webhooks.constructEvent() verify chữ ký HMAC của Stripe.
> Fake webhook không qua được — order status không thay đổi."

---

## Câu hỏi thường gặp

**Q: Tại sao dùng Stripe.js thay vì gửi số thẻ lên server?**
A: PCI-DSS yêu cầu. Nếu số thẻ qua server, phải audit PCI Level 1 (rất tốn kém). Dùng Stripe.js → chỉ cần SAQ A.

**Q: Nonce dùng để làm gì?**
A: Chống replay attack. Mỗi request có 1 UUID random + timestamp. Nếu dùng lại nonce → server reject.

**Q: HMAC signature trong transaction log để làm gì?**
A: Đảm bảo tính bất biến (integrity). Nếu ai đó sửa DB trực tiếp, HMAC sẽ không khớp → phát hiện tampering.

**Q: Webhook signature verify hoạt động như thế nào?**
A: Stripe ký body bằng HMAC-SHA256 với webhook secret. Server dùng `constructEvent()` để verify. Nếu body bị sửa hoặc secret sai → throw error.
