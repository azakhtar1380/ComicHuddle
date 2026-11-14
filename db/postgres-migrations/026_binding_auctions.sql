-- Additive: binding eBay-style auctions (reserve, proxy maximum bids, resolution, winner payment window).
-- Legacy auction previews have no terms row and keep their original nonbinding behavior.
-- Order pickup codes, protection tiers and inspection state live in commerce_orders.state/snapshot JSON.
CREATE TABLE IF NOT EXISTS ch_web.marketplace_auction_terms (
  listing_id text PRIMARY KEY,
  reserve_cents bigint CHECK (reserve_cents IS NULL OR reserve_cents >= 100),
  result text NOT NULL DEFAULT '' CHECK (result IN ('','no_bids','reserve_not_met','awaiting_payment','paid','unpaid')),
  winner_id text,
  winning_cents bigint,
  resolved_at text,
  payment_due_at text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS marketplace_auction_terms_open ON ch_web.marketplace_auction_terms (result, payment_due_at);
CREATE TABLE IF NOT EXISTS ch_web.auction_bid_maxes (
  bid_id text PRIMARY KEY,
  listing_id text NOT NULL,
  bidder_id text NOT NULL,
  max_cents bigint NOT NULL CHECK (max_cents >= 100),
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS auction_bid_maxes_listing ON ch_web.auction_bid_maxes (listing_id, max_cents DESC, created_at);
