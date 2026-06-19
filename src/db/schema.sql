-- Development reset schema. Do not run against production data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS refund_requests CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS request_nonces CASCADE;
DROP TABLE IF EXISTS payment_attempts CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS receipt_signing_keys CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS merchants CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              VARCHAR(20) NOT NULL DEFAULT 'customer'
                    CHECK (role IN ('customer', 'merchant', 'admin')),

  encrypted_name    TEXT,
  name_iv           VARCHAR(50),
  name_auth_tag     VARCHAR(50),

  encrypted_address TEXT,
  address_iv        VARCHAR(50),
  address_auth_tag  VARCHAR(50),

  encrypted_cccd    TEXT,
  cccd_iv           VARCHAR(50),
  cccd_auth_tag     VARCHAR(50),

  wrapped_data_key  TEXT,
  key_version       INTEGER NOT NULL DEFAULT 1,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE merchants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  status       VARCHAR(30) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'disabled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  name        VARCHAR(255) NOT NULL,
  price       BIGINT NOT NULL CHECK (price >= 0),
  currency    VARCHAR(10) NOT NULL DEFAULT 'vnd',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id              UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  status                   VARCHAR(30) NOT NULL DEFAULT 'pending',
  total_amount             BIGINT NOT NULL CHECK (total_amount >= 0),
  currency                 VARCHAR(10) NOT NULL DEFAULT 'vnd',
  shipping_address         TEXT NOT NULL,
  stripe_payment_intent_id VARCHAR(255),
  payment_provider         VARCHAR(50) DEFAULT 'stripe',
  order_items_hash         VARCHAR(64),
  hmac_signature           VARCHAR(128),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL,
  quantity     INT NOT NULL CHECK (quantity > 0),
  unit_price   BIGINT NOT NULL CHECK (unit_price >= 0),
  currency     VARCHAR(10) NOT NULL DEFAULT 'vnd',
  line_total   BIGINT NOT NULL CHECK (line_total >= 0),
  subtotal     BIGINT GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE payment_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payer_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id            UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  provider              VARCHAR(50) NOT NULL,
  provider_payment_id    VARCHAR(255),
  amount                BIGINT NOT NULL CHECK (amount >= 0),
  currency              VARCHAR(10) NOT NULL DEFAULT 'vnd',
  idempotency_key       VARCHAR(255) NOT NULL,
  status                VARCHAR(50) NOT NULL DEFAULT 'created',
  raw_provider_response JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payer_user_id, idempotency_key),
  UNIQUE (provider, provider_payment_id)
);

CREATE TABLE transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id),
  user_id            UUID NOT NULL REFERENCES users(id),
  payer_user_id      UUID NOT NULL REFERENCES users(id),
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  stripe_payment_id  VARCHAR(255),
  provider           VARCHAR(50) NOT NULL DEFAULT 'stripe',
  provider_payment_id VARCHAR(255),
  amount             BIGINT NOT NULL,
  currency           VARCHAR(10) NOT NULL DEFAULT 'vnd',
  status             VARCHAR(30) NOT NULL,
  stripe_token_last4 VARCHAR(10),
  hmac_signature     VARCHAR(128),
  jws_receipt        TEXT,
  receipt_id         UUID,
  order_items_hash   VARCHAR(64),
  refund_id          VARCHAR(255),
  refunded_at        TIMESTAMPTZ,
  refund_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE request_nonces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce         VARCHAR(255) NOT NULL,
  request_type  VARCHAR(100) NOT NULL,
  request_hash  VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, nonce, request_type)
);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
  provider_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  provider_payment_id VARCHAR(255),
  processing_status VARCHAR(50) NOT NULL DEFAULT 'received',
  raw_payload JSONB,
  error_message TEXT,
  mismatch_reason TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     UUID NOT NULL REFERENCES transactions(id),
  order_id           UUID NOT NULL REFERENCES orders(id),
  payer_user_id      UUID NOT NULL REFERENCES users(id),
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  requested_by       UUID NOT NULL REFERENCES users(id),
  approved_by        UUID REFERENCES users(id),
  amount             BIGINT NOT NULL CHECK (amount > 0),
  currency           VARCHAR(10) NOT NULL DEFAULT 'vnd',
  reason             TEXT NOT NULL,
  provider           VARCHAR(50) NOT NULL,
  provider_payment_id VARCHAR(255),
  provider_refund_id VARCHAR(255),
  idempotency_key    VARCHAR(255) NOT NULL,
  status             VARCHAR(50) NOT NULL DEFAULT 'processing',
  provider_status    VARCHAR(50),
  provider_error     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requested_by, idempotency_key)
);

CREATE TABLE refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  transaction_id UUID REFERENCES transactions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  payer_user_id UUID REFERENCES users(id),
  merchant_id UUID REFERENCES merchants(id),
  amount BIGINT NOT NULL,
  provider VARCHAR(50),
  provider_payment_id VARCHAR(255),
  reason TEXT NOT NULL,
  details TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN (
      'pending_review',
      'cancelled',
      'rejected',
      'approved_processing',
      'succeeded',
      'provider_failed'
    )),
  admin_decision VARCHAR(50),
  provider_status VARCHAR(50),
  admin_note TEXT,
  provider_refund_id VARCHAR(255),
  provider_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  VARCHAR(80) NOT NULL,
  user_id     UUID REFERENCES users(id),
  actor_user_id UUID REFERENCES users(id),
  target_type VARCHAR(100),
  target_id   VARCHAR(255),
  ip_address  INET,
  user_agent  TEXT,
  payload     JSONB,
  metadata    JSONB,
  hmac_sig    VARCHAR(128),
  previous_hash TEXT,
  prev_hash   TEXT,
  current_hash TEXT,
  chain_version VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE receipt_signing_keys (
  key_version INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

CREATE INDEX idx_merchants_user_id ON merchants(user_id);
CREATE INDEX idx_products_merchant_id ON products(merchant_id);
CREATE INDEX idx_products_active ON products(active);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_merchant_id ON order_items(merchant_id);
CREATE INDEX idx_payment_attempts_order_id ON payment_attempts(order_id);
CREATE INDEX idx_payment_attempts_payer ON payment_attempts(payer_user_id);
CREATE INDEX idx_transactions_order_id ON transactions(order_id);
CREATE INDEX idx_transactions_payer ON transactions(payer_user_id);
CREATE INDEX idx_transactions_merchant ON transactions(merchant_id);
CREATE UNIQUE INDEX idx_transactions_provider_payment_id_unique
  ON transactions(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX idx_transactions_stripe_payment_id_unique
  ON transactions(stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;
CREATE INDEX idx_request_nonces_expires_at ON request_nonces(expires_at);
CREATE INDEX idx_webhook_events_provider_payment_id ON webhook_events(provider_payment_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(processing_status);
CREATE INDEX idx_refunds_transaction_id ON refunds(transaction_id);
CREATE INDEX idx_refunds_merchant_id ON refunds(merchant_id);
CREATE UNIQUE INDEX idx_refunds_active_transaction_unique
  ON refunds(transaction_id)
  WHERE status IN ('processing', 'pending', 'succeeded');
CREATE INDEX idx_refund_requests_user_id ON refund_requests(user_id);
CREATE INDEX idx_refund_requests_merchant_id ON refund_requests(merchant_id);
CREATE INDEX idx_refund_requests_status ON refund_requests(status);
CREATE UNIQUE INDEX idx_refund_requests_active_order_unique
  ON refund_requests(order_id)
  WHERE status IN ('pending_review', 'approved_processing');
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE UNIQUE INDEX idx_receipt_signing_keys_single_active
  ON receipt_signing_keys(active)
  WHERE active = TRUE;
