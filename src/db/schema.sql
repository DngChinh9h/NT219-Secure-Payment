-- Xóa và tạo lại (chỉ dùng khi dev)
    DROP TABLE IF EXISTS audit_logs CASCADE;
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS order_items CASCADE;
    DROP TABLE IF EXISTS orders CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    
    -- Bảng users
    -- Lưu ý: PII (fullName, address, cccdNumber) được mã hóa bởi TV2 (AES-256-GCM)
    CREATE TABLE users (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email             VARCHAR(255) UNIQUE NOT NULL,
      password_hash     VARCHAR(255) NOT NULL,
      role              VARCHAR(20) NOT NULL DEFAULT 'customer',
    
      -- PII được mã hóa — TV2 xử lý
      encrypted_name    TEXT,
      name_iv           VARCHAR(50),
      name_auth_tag     VARCHAR(50),
    
      encrypted_address TEXT,
      address_iv        VARCHAR(50),
      address_auth_tag  VARCHAR(50),
    
      encrypted_cccd    TEXT,
      cccd_iv           VARCHAR(50),
      cccd_auth_tag     VARCHAR(50),
    
      wrapped_data_key  TEXT,         -- Data Key được wrap bằng Master Key (KMS)
    
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Bảng orders
    -- orderId dùng UUID thay integer (fix #4 — IDOR prevention)
    CREATE TABLE orders (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status            VARCHAR(30) NOT NULL DEFAULT 'pending',
      -- pending | paid | failed | cancelled
    
      total_amount      BIGINT NOT NULL,  -- Lưu đơn vị nhỏ nhất (VND/cents), tránh float
      shipping_address  TEXT NOT NULL,
      stripe_payment_intent_id VARCHAR(255),
    
      hmac_signature    VARCHAR(128),     -- HMAC ký toàn bộ order data (integrity check)
    
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Bảng order_items
    CREATE TABLE order_items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id  UUID NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity    INT NOT NULL CHECK (quantity > 0),
      unit_price  BIGINT NOT NULL CHECK (unit_price >= 0),
      subtotal    BIGINT GENERATED ALWAYS AS (quantity * unit_price) STORED
    );
    
    -- Bảng transactions
    CREATE TABLE transactions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id          UUID NOT NULL REFERENCES orders(id),
      user_id           UUID NOT NULL REFERENCES users(id),
      stripe_payment_id VARCHAR(255),
      amount            BIGINT NOT NULL,
      currency          VARCHAR(10) NOT NULL DEFAULT 'vnd',
      status            VARCHAR(30) NOT NULL,
      -- success | failed | refunded
    
      stripe_token_last4 VARCHAR(10),   -- Chỉ lưu last4, KHÔNG lưu số thẻ (PCI-DSS)
    
      hmac_signature    VARCHAR(128),   -- HMAC ký log entry (bất biến)
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Bảng audit_logs — append only, không UPDATE/DELETE
    CREATE TABLE audit_logs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type  VARCHAR(50) NOT NULL,
      -- LOGIN_SUCCESS | LOGIN_FAIL | ORDER_CREATED | PAYMENT_ATTEMPT
      -- PAYMENT_SUCCESS | PAYMENT_FAIL | WEBHOOK_RECEIVED | REPLAY_DETECTED
    
      user_id     UUID REFERENCES users(id),
      ip_address  INET,
      user_agent  TEXT,
      payload     JSONB,          -- Chi tiết event (không chứa sensitive data)
      hmac_sig    VARCHAR(128),   -- HMAC ký log entry
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Indexes
    CREATE INDEX idx_orders_user_id ON orders(user_id);
    CREATE INDEX idx_orders_status  ON orders(status);
    CREATE INDEX idx_transactions_order_id ON transactions(order_id);
    CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
    CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
    CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
    