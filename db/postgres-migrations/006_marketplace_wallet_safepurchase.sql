ALTER TABLE ch_web.listings ADD COLUMN safe_purchase_opt_in bigint NOT NULL DEFAULT 0 CHECK (safe_purchase_opt_in IN (0,1));
ALTER TABLE ch_web.listings ADD COLUMN safe_purchase_verified_at timestamptz;
ALTER TABLE ch_web.listings ADD COLUMN location_zip text NOT NULL DEFAULT '';
ALTER TABLE ch_web.listings ADD COLUMN location_city text NOT NULL DEFAULT '';
ALTER TABLE ch_web.listings ADD COLUMN location_state text NOT NULL DEFAULT '';
ALTER TABLE ch_web.listings ADD COLUMN latitude double precision CHECK (latitude BETWEEN -90 AND 90);
ALTER TABLE ch_web.listings ADD COLUMN longitude double precision CHECK (longitude BETWEEN -180 AND 180);
ALTER TABLE ch_web.care_providers ADD COLUMN location_zip text NOT NULL DEFAULT '';
ALTER TABLE ch_web.care_providers ADD COLUMN location_city text NOT NULL DEFAULT '';
ALTER TABLE ch_web.care_providers ADD COLUMN location_state text NOT NULL DEFAULT '';
ALTER TABLE ch_web.care_providers ADD COLUMN latitude double precision CHECK (latitude BETWEEN -90 AND 90);
ALTER TABLE ch_web.care_providers ADD COLUMN longitude double precision CHECK (longitude BETWEEN -180 AND 180);
CREATE INDEX listing_active_location ON ch_web.listings(status,latitude,longitude);
CREATE INDEX specialist_visible_location ON ch_web.care_providers(visible,latitude,longitude);
CREATE TABLE ch_web.marketplace_sales (
  listing_id text PRIMARY KEY REFERENCES ch_web.listings(id),seller_user_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('platform','cash_local')),
  gross_cents bigint NOT NULL CHECK (gross_cents BETWEEN 0 AND 100000000),
  payment_verified bigint NOT NULL DEFAULT 0 CHECK (payment_verified IN (0,1)),
  order_id text REFERENCES ch_web.commerce_orders(id),sold_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_verified=0 OR (source='platform' AND order_id IS NOT NULL))
);
CREATE INDEX marketplace_sales_seller_time ON ch_web.marketplace_sales(seller_user_id,sold_at DESC);
CREATE TABLE ch_web.safe_purchase_requests (
  id text PRIMARY KEY,listing_id text NOT NULL REFERENCES ch_web.listings(id),buyer_user_id text NOT NULL,seller_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','received_at_vault','inspected','shipped_to_buyer','completed','declined','cancelled')),
  inspection_reference text,inspected_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(listing_id,buyer_user_id),CHECK (buyer_user_id<>seller_user_id),
  CHECK (status NOT IN ('inspected','shipped_to_buyer','completed') OR (inspection_reference IS NOT NULL AND inspected_at IS NOT NULL))
);
-- Proceeds/activity ledger; balance-changing rows require verified order events.
CREATE TABLE ch_web.collector_wallet_entries (
  id text PRIMARY KEY,user_id text NOT NULL,order_id text NOT NULL REFERENCES ch_web.commerce_orders(id),
  mode text NOT NULL CHECK (mode IN ('live','sandbox')),
  bucket text NOT NULL CHECK (bucket IN ('pending','available','activity')),
  kind text NOT NULL CHECK (kind IN ('sale_pending','pending_release','sale_proceeds','pending_refund','purchase','refund')),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN -100000000 AND 100000000),source_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,order_id,mode,kind)
);
CREATE INDEX collector_wallet_user_time ON ch_web.collector_wallet_entries(user_id,created_at DESC,id);
CREATE INDEX collector_wallet_user_balance ON ch_web.collector_wallet_entries(user_id,mode,bucket);
CREATE TABLE ch_web.wallet_reconciliation_checks (
  user_id text NOT NULL,order_id text NOT NULL REFERENCES ch_web.commerce_orders(id),order_version bigint NOT NULL CHECK (order_version>=0),
  valid boolean NOT NULL,checked_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,order_id)
);
