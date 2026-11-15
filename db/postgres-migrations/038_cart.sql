-- Additive only: a persistent shopping cart per signed-in account (round 4, cart).
-- One row per (account, listing): quantity is always 1 because every listing is a single sale.
-- saved_for_later rows stay out of the checkout total. price_cents/shipping_cents are the values the
-- buyer saw when adding, used only to flag a later price change; checkout always re-reads the listing.
-- No foreign keys; existing tables untouched. Holds are NOT stored here: checkout uses the existing
-- commerce_orders reservation (listing status 'checkout_reserved' + Stripe session expiry).
CREATE TABLE IF NOT EXISTS ch_web.cart_items (
 user_id text NOT NULL,
 listing_id text NOT NULL,
 saved_for_later boolean NOT NULL DEFAULT false,
 price_cents bigint NOT NULL DEFAULT 0,
 shipping_cents bigint NOT NULL DEFAULT 0,
 added_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS cart_items_user_time ON ch_web.cart_items (user_id, added_at DESC);
CREATE INDEX IF NOT EXISTS cart_items_listing ON ch_web.cart_items (listing_id);
