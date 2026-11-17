-- Seller strikes (cleanup round 2). Safe to re-run. One row per order where the seller missed the shipping deadline
-- on a won auction (the buyer was refunded). Admins see the count per seller; nothing is shown publicly.
CREATE TABLE IF NOT EXISTS ch_web.seller_strikes (
 id text PRIMARY KEY,
 seller_id text NOT NULL,
 order_id text NOT NULL UNIQUE,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_strikes_seller ON ch_web.seller_strikes(seller_id,created_at DESC);
