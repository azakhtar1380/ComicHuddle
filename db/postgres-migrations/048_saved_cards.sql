-- Additive only: saved cards for auctions, and automatic charging of auction winners.
-- A buyer saves a card (Stripe Checkout in setup mode) and a shipping address before their first auction bid.
-- When they win, the daily job charges that card off-session. Only the Stripe customer and payment method IDs and the
-- card's brand, last 4 digits and expiry are stored here; card numbers never reach ComicHuddle.
CREATE TABLE IF NOT EXISTS ch_web.buyer_saved_cards (
 user_id text NOT NULL,
 sandbox bigint NOT NULL CHECK (sandbox IN (0,1)),
 profile_id text NOT NULL,
 stripe_customer_id text NOT NULL,
 payment_method_id text,
 card_brand text NOT NULL DEFAULT '',
 card_last4 text NOT NULL DEFAULT '',
 card_exp text NOT NULL DEFAULT '',
 shipping_address text NOT NULL DEFAULT '',
 setup_session_id text,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','removed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, sandbox)
);
-- One row per won auction. A short lease stops two runs charging at once; Stripe idempotency covers retries.
CREATE TABLE IF NOT EXISTS ch_web.auction_auto_charges (
 listing_id text PRIMARY KEY,
 winner_user_id text NOT NULL,
 request_id text NOT NULL,
 order_id text,
 status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','charged','failed','skipped')),
 reason text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auction_auto_charges_status ON ch_web.auction_auto_charges (status, updated_at);
