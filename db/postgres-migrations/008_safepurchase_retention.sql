-- Nonfinancial manual-sale records follow their listing's deletion. Actual
-- processor/order history continues to require operator retention review.
ALTER TABLE ch_web.marketplace_sales DROP CONSTRAINT marketplace_sales_listing_id_fkey;
ALTER TABLE ch_web.marketplace_sales ADD CONSTRAINT marketplace_sales_listing_id_fkey
  FOREIGN KEY(listing_id) REFERENCES ch_web.listings(id) ON DELETE CASCADE;
ALTER TABLE ch_web.safe_purchase_requests DROP CONSTRAINT safe_purchase_requests_listing_id_fkey;
ALTER TABLE ch_web.safe_purchase_requests ADD CONSTRAINT safe_purchase_requests_listing_id_fkey
  FOREIGN KEY(listing_id) REFERENCES ch_web.listings(id) ON DELETE CASCADE;
ALTER TABLE ch_web.listings ADD CONSTRAINT safe_purchase_verification_requires_selection
  CHECK (safe_purchase_verified_at IS NULL OR safe_purchase_opt_in=1);
