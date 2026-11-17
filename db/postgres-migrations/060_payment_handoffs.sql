-- On-page payments (cleanup round 2). Safe to re-run.
-- payment_handoffs: one-time "Pay on your phone" codes. Only a SHA-256 hash of the code is stored; each code works
-- once, for 10 minutes, for the same signed-in buyer and the same unpaid order.
CREATE TABLE IF NOT EXISTS ch_web.payment_handoffs (
 token_hash text PRIMARY KEY,
 order_id text NOT NULL,
 user_id text NOT NULL,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_handoffs_order ON ch_web.payment_handoffs(order_id,created_at DESC);
-- buyer_addresses: the buyer's private saved shipping address (prefills checkout). Never shown to other members.
CREATE TABLE IF NOT EXISTS ch_web.buyer_addresses (
 user_id text PRIMARY KEY,
 shipping_address text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
