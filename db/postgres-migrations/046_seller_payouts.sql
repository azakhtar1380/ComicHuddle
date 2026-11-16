-- Additive only: bank payouts from sellers' Stripe balances (lib/seller-payouts.ts). The release (platform →
-- seller's Stripe account) stays in commerce_money_requests; this table is the separate bank payout step.
-- New-tier sellers are paid out manually 7 days after delivery/pickup (order_id set); trusted sellers are on
-- Stripe's daily schedule, and their payout.* webhook events are recorded here too (order_id NULL).
CREATE TABLE IF NOT EXISTS ch_web.seller_payouts (
 id text PRIMARY KEY,
 order_id text UNIQUE,
 seller_user_id text NOT NULL,
 account_id text NOT NULL,
 stripe_payout_id text UNIQUE,
 amount_cents integer NOT NULL CHECK (amount_cents > 0),
 status text NOT NULL CHECK (status IN ('pending','in_transit','paid','failed','canceled')),
 failure_message text NOT NULL DEFAULT '',
 sandbox bigint NOT NULL DEFAULT 1 CHECK (sandbox IN (0,1)),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_payouts_seller ON ch_web.seller_payouts (seller_user_id, created_at DESC);
