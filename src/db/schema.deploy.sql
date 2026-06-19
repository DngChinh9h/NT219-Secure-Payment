-- Deploy-safe migration. This file only creates/extends objects; it does not drop data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              VARCHAR(20) NOT NULL DEFAULT 'customer',
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_iv VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_auth_tag VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address_iv VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address_auth_tag VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_cccd TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cccd_iv VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cccd_auth_tag VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS wrapped_data_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_allowed'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_allowed
      CHECK (role IN ('customer', 'merchant', 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS merchants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  status       VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  name        VARCHAR(255) NOT NULL,
  price       BIGINT NOT NULL CHECK (price >= 0),
  currency    VARCHAR(10) NOT NULL DEFAULT 'vnd',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   VARCHAR(30) NOT NULL DEFAULT 'pending',
  total_amount             BIGINT NOT NULL DEFAULT 0,
  shipping_address         TEXT NOT NULL,
  stripe_payment_intent_id VARCHAR(255),
  hmac_signature           VARCHAR(128),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'vnd';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(50) DEFAULT 'stripe';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_items_hash VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hmac_signature VARCHAR(128);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity     INT NOT NULL CHECK (quantity > 0),
  unit_price   BIGINT NOT NULL CHECK (unit_price >= 0),
  subtotal     BIGINT GENERATED ALWAYS AS (quantity * unit_price) STORED
);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE RESTRICT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'vnd';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total BIGINT;
UPDATE order_items SET line_total = quantity * unit_price WHERE line_total IS NULL;
ALTER TABLE order_items ALTER COLUMN line_total SET NOT NULL;

CREATE TABLE IF NOT EXISTS payment_attempts (
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
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id),
  user_id            UUID NOT NULL REFERENCES users(id),
  stripe_payment_id  VARCHAR(255),
  amount             BIGINT NOT NULL,
  currency           VARCHAR(10) NOT NULL DEFAULT 'vnd',
  status             VARCHAR(30) NOT NULL,
  stripe_token_last4 VARCHAR(10),
  hmac_signature     VARCHAR(128),
  jws_receipt        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES users(id);
UPDATE transactions SET payer_user_id = user_id WHERE payer_user_id IS NULL;
ALTER TABLE transactions ALTER COLUMN payer_user_id SET NOT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'stripe';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receipt_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_items_hash VARCHAR(64);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS jws_receipt TEXT;

CREATE TABLE IF NOT EXISTS request_nonces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce         VARCHAR(255) NOT NULL,
  request_type  VARCHAR(100) NOT NULL,
  request_hash  VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, nonce, request_type)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
  provider_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  provider_payment_id VARCHAR(255),
  processing_status VARCHAR(50) NOT NULL DEFAULT 'received',
  raw_payload JSONB,
  error_message TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, provider_event_id)
);

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS mismatch_reason TEXT;

CREATE TABLE IF NOT EXISTS refunds (
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
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  transaction_id UUID REFERENCES transactions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount BIGINT NOT NULL,
  provider VARCHAR(50),
  provider_payment_id VARCHAR(255),
  reason TEXT NOT NULL,
  details TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
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

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES users(id);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS admin_decision VARCHAR(50);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS provider_status VARCHAR(50);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS provider_refund_id VARCHAR(255);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS provider_error TEXT;

CREATE TABLE IF NOT EXISTS audit_logs (
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

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS current_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_type VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_id VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_version VARCHAR(50);

CREATE TABLE IF NOT EXISTS receipt_signing_keys (
  key_version INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

-- Private receipt keys are now filesystem material owned only by Security Service.
-- Existing encrypted private-key columns are intentionally removed during this hardening migration.
ALTER TABLE receipt_signing_keys DROP COLUMN IF EXISTS encrypted_private_key;
ALTER TABLE receipt_signing_keys DROP COLUMN IF EXISTS private_key_iv;
ALTER TABLE receipt_signing_keys DROP COLUMN IF EXISTS private_key_auth_tag;
ALTER TABLE receipt_signing_keys DROP COLUMN IF EXISTS wrapped_data_key;
REVOKE ALL ON receipt_signing_keys FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON merchants(user_id);
CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_merchant_id ON order_items(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payer ON payment_attempts(payer_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_idempotency
  ON payment_attempts(payer_user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_provider_payment
  ON payment_attempts(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payer ON transactions(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_provider_payment_id_unique
  ON transactions(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_stripe_payment_id_unique
  ON transactions(stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_request_nonces_expires_at ON request_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_payment_id ON webhook_events(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_refunds_transaction_id ON refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_merchant_id ON refunds(merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_idempotency
  ON refunds(requested_by, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_active_transaction_unique
  ON refunds(transaction_id)
  WHERE status IN ('processing', 'pending', 'succeeded');
CREATE INDEX IF NOT EXISTS idx_refund_requests_user_id ON refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_merchant_id ON refund_requests(merchant_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_active_order_unique
  ON refund_requests(order_id)
  WHERE status IN ('pending_review', 'approved_processing');
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_signing_keys_single_active
  ON receipt_signing_keys(active)
  WHERE active = TRUE;
