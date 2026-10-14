-- Run as an operator capable of CREATE ROLE, following 001-platform.sql.
BEGIN;
CREATE ROLE ch_platform_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE ch_platform_collector NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE ch_platform_service NOLOGIN NOSUPERUSER NOBYPASSRLS;
REVOKE ALL ON SCHEMA ch_platform FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ch_platform FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ch_platform FROM PUBLIC;
GRANT USAGE ON SCHEMA ch_platform TO ch_platform_reader,ch_platform_collector,ch_platform_service;
GRANT SELECT ON ch_platform.publishers,ch_platform.series,ch_platform.characters,ch_platform.key_categories,ch_platform.grade_profiles TO ch_platform_reader,ch_platform_collector;
CREATE VIEW ch_platform.public_comics AS SELECT c.id,c.series_id,c.issue_number,c.issue_title,c.publication_date,c.printing_type,c.printing_number,c.variant_code,c.source,c.source_url,c.attribution,c.license_name
 FROM ch_platform.comics c WHERE c.metadata_status='canonical';
CREATE VIEW ch_platform.public_covers AS SELECT i.comic_id,i.url,i.width,i.height,i.rights_basis,i.rights_reference FROM ch_platform.comic_images i JOIN ch_platform.comics c ON c.id=i.comic_id
 WHERE c.metadata_status='canonical' AND i.display_allowed AND (i.license_expires_at IS NULL OR i.license_expires_at>now());
GRANT SELECT ON ch_platform.public_comics,ch_platform.public_covers TO ch_platform_reader,ch_platform_collector;
GRANT SELECT ON ch_platform.user_collections,ch_platform.collection_items,ch_platform.user_wallets,ch_platform.wallet_transactions,ch_platform.withdrawals,ch_platform.reward_points_ledger,ch_platform.ai_authenticity_scans,ch_platform.ebay_listings TO ch_platform_collector;
GRANT EXECUTE ON FUNCTION ch_platform.actor_id() TO ch_platform_collector;
-- Only the authenticated backend's fixed service connection receives these
-- grants. Never distribute it to browsers or run it as a superuser/DB owner.
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ch_platform TO ch_platform_service;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ch_platform TO ch_platform_service;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['user_collections','collection_items','user_wallets','wallet_transactions','reward_points_ledger','withdrawals','ai_authenticity_scans','ebay_connections','ebay_oauth_sessions','ebay_listings'] LOOP
  EXECUTE format('CREATE POLICY backend_only ON ch_platform.%I TO ch_platform_service USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE FUNCTION ch_platform.seal_order_money() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'pending_payment' AND (NEW.subtotal_cents,NEW.shipping_cents,NEW.tax_cents,NEW.platform_fee_cents,NEW.discount_cents,NEW.buyer_id,NEW.seller_id,NEW.listing_id,NEW.currency)
  IS DISTINCT FROM (OLD.subtotal_cents,OLD.shipping_cents,OLD.tax_cents,OLD.platform_fee_cents,OLD.discount_cents,OLD.buyer_id,OLD.seller_id,OLD.listing_id,OLD.currency)
 THEN RAISE EXCEPTION 'Paid order amounts and identities are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER seal_order BEFORE UPDATE ON ch_platform.orders FOR EACH ROW EXECUTE FUNCTION ch_platform.seal_order_money();
ALTER TABLE ch_platform.orders ADD CONSTRAINT order_seller_matches_listing FOREIGN KEY(listing_id,seller_id) REFERENCES ch_platform.marketplace_listings(id,seller_id);
CREATE FUNCTION ch_platform.check_order_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid; listing uuid; owner uuid;
BEGIN
 IF TG_TABLE_NAME='orders' THEN oid:=NEW.id; ELSE oid:=NEW.order_id; END IF;
 SELECT listing_id,seller_id INTO listing,owner FROM ch_platform.orders WHERE id=oid;
 IF EXISTS(SELECT 1 FROM ch_platform.order_items i WHERE i.order_id=oid AND NOT EXISTS(
  SELECT 1 FROM ch_platform.listing_items l JOIN ch_platform.collection_items p ON p.id=l.collection_item_id
  WHERE l.listing_id=listing AND l.collection_item_id=i.collection_item_id AND l.comic_id=i.comic_id AND l.seller_id=owner AND p.grade_key=i.grade_key))
 OR (SELECT count(*) FROM ch_platform.order_items WHERE order_id=oid)<>(SELECT count(*) FROM ch_platform.listing_items WHERE listing_id=listing)
 THEN RAISE EXCEPTION 'Order must snapshot every exact listing copy' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_inventory AFTER INSERT ON ch_platform.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ch_platform.check_order_inventory();
CREATE CONSTRAINT TRIGGER order_lines_inventory AFTER INSERT ON ch_platform.order_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ch_platform.check_order_inventory();
COMMIT;
