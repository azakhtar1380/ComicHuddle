-- Additive only: calculated shipping (lib/shipping-rates.ts). 1 = the buyer pays a live carrier rate from the
-- seller's ZIP (listings.location_zip) to their address, chosen at checkout; listings.shipping stays 0.
-- 0 = the stored flat amount (0 means free shipping; older listings keep their seller-entered amount).
ALTER TABLE ch_web.listings ADD COLUMN IF NOT EXISTS shipping_calculated bigint NOT NULL DEFAULT 0 CHECK (shipping_calculated IN (0,1));
