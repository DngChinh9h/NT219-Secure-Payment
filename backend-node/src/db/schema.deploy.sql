-- Deploy-safe migration — không mất data
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

CREATE TABLE IF NOT EXISTS orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   VARCHAR(30) NOT NULL DEFAULT 'pending',
  total_amount             BIGINT NOT NULL,
  shipping_address         TEXT NOT NULL,
  stripe_payment_intent_id VARCHAR(255),
  hmac_signature           VARCHAR(128),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity     INT NOT NULL CHECK (quantity > 0),
  unit_price   BIGINT NOT NULL CHECK (unit_price >= 0),
  subtotal     BIGINT GENERATED ALWAYS AS (quantity * unit_price) STORED
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

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  VARCHAR(50) NOT NULL,
  user_id     UUID REFERENCES users(id),
  actor_user_id UUID REFERENCES users(id),
  target_type VARCHAR(100),
  target_id   VARCHAR(255),
  ip_address  INET,
  user_agent  TEXT,
  payload     JSONB,
  metadata    JSONB,
  hmac_sig    VARCHAR(128),
  prev_hash   TEXT,
  current_hash TEXT,
  chain_version VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  received_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  UNIQUE(provider, provider_event_id)
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

CREATE TABLE IF NOT EXISTS receipt_signing_keys (
  key_version INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  private_key_iv VARCHAR(50) NOT NULL,
  private_key_auth_tag VARCHAR(50) NOT NULL,
  wrapped_data_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

-- Upgrade columns for existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
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

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS jws_receipt TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(50) DEFAULT 'stripe';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'stripe';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS current_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_user_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_type VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_id VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_version VARCHAR(50);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS admin_decision VARCHAR(50);
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS provider_status VARCHAR(50);

-- Indexes (CREATE INDEX IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_provider_payment_id ON transactions(provider_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_stripe_payment_id_unique
ON transactions(stripe_payment_id)
WHERE stripe_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_payment_id
ON webhook_events(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
ON webhook_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_user_id
ON refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status
ON refund_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_active_order_unique
ON refund_requests(order_id)
WHERE status IN ('pending_review', 'approved_processing');
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_signing_keys_single_active
ON receipt_signing_keys(active)
WHERE active = TRUE;
