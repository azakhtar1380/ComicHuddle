-- Additive only: optional package details for calculated shipping. NULL = sized automatically from what is
-- sold (lib/shipping-rates.ts parcelFor). The ship-from ZIP is listings.location_zip.
ALTER TABLE ch_web.listings ADD COLUMN IF NOT EXISTS weight_oz integer CHECK (weight_oz IS NULL OR weight_oz BETWEEN 1 AND 2400);
ALTER TABLE ch_web.listings ADD COLUMN IF NOT EXISTS length_in integer CHECK (length_in IS NULL OR length_in BETWEEN 1 AND 108);
ALTER TABLE ch_web.listings ADD COLUMN IF NOT EXISTS width_in integer CHECK (width_in IS NULL OR width_in BETWEEN 1 AND 108);
ALTER TABLE ch_web.listings ADD COLUMN IF NOT EXISTS height_in integer CHECK (height_in IS NULL OR height_in BETWEEN 1 AND 108);
