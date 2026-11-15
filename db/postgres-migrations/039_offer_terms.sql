-- Additive only: counter-offers and per-round expiry for marketplace offers (Offers & trades page).
-- One row per offer. ch_web.offers keeps the amount currently on the table and its status
-- ('pending' = seller's turn, 'countered' = buyer's turn, 'accepted', 'declined', 'withdrawn', 'closed').
-- This side table adds the round history and deadlines. No foreign keys; existing tables untouched.
-- Code that predates this table keeps working: expiry falls back to created_at + 48 hours and
-- counter-offers stay switched off until this file is applied.
CREATE TABLE IF NOT EXISTS ch_web.offer_terms (
 offer_id text PRIMARY KEY,
 original_cents bigint NOT NULL,
 rounds integer NOT NULL DEFAULT 0,
 last_actor text NOT NULL DEFAULT 'buyer',
 expires_at timestamptz NOT NULL,
 accepted_at timestamptz NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT offer_terms_actor CHECK (last_actor IN ('buyer','seller')),
 CONSTRAINT offer_terms_rounds CHECK (rounds >= 0 AND rounds <= 20),
 CONSTRAINT offer_terms_original CHECK (original_cents > 0)
);
CREATE INDEX IF NOT EXISTS offer_terms_expiry ON ch_web.offer_terms (expires_at);
CREATE INDEX IF NOT EXISTS offers_buyer_time ON ch_web.offers (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS offers_listing_status ON ch_web.offers (listing_id, status);
