-- Run AFTER schema.sql as a database administrator in an isolated review database.
-- These are NOLOGIN capability roles. Create separate server login principals and grant
-- only their required memberships. This file does not create credentials or grant PUBLIC.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_owner') THEN CREATE ROLE comichuddle_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_reader') THEN CREATE ROLE comichuddle_reader NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_collector') THEN CREATE ROLE comichuddle_collector NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_valuator') THEN CREATE ROLE comichuddle_valuator NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_moderator') THEN CREATE ROLE comichuddle_moderator NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_ingest') THEN CREATE ROLE comichuddle_ingest NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comichuddle_commerce') THEN CREATE ROLE comichuddle_commerce NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
-- Explicitly transfer ONLY this isolated schema; do not REASSIGN OWNED across a production database.
ALTER SCHEMA comichuddle OWNER TO comichuddle_owner;
DO $$ DECLARE o record; BEGIN
  FOR o IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='comichuddle' AND c.relkind IN ('r','v') LOOP
    EXECUTE format('ALTER %s comichuddle.%I OWNER TO comichuddle_owner',CASE WHEN o.relkind='v' THEN 'VIEW' ELSE 'TABLE' END,o.relname);
  END LOOP;
  FOR o IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='comichuddle' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO comichuddle_owner',o.signature);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA comichuddle FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA comichuddle FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA comichuddle FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE comichuddle_owner IN SCHEMA comichuddle REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA comichuddle TO comichuddle_reader,comichuddle_collector,comichuddle_valuator,comichuddle_moderator,comichuddle_ingest,comichuddle_commerce;
GRANT comichuddle_reader TO comichuddle_collector,comichuddle_valuator,comichuddle_moderator;
GRANT EXECUTE ON FUNCTION comichuddle.actor_user_id() TO comichuddle_reader,comichuddle_ingest,comichuddle_commerce;
GRANT EXECUTE ON FUNCTION comichuddle.evaluate_fmv_quote(uuid,timestamptz) TO comichuddle_reader;
GRANT EXECUTE ON FUNCTION comichuddle.resolve_directory_id(uuid) TO comichuddle_reader;
GRANT SELECT ON comichuddle.directory_comics,comichuddle.directory_comics_fmv,comichuddle.marketplace_item_facts TO comichuddle_reader;
-- Private proof and license references: server valuation role only; API must use publicDealAnalysis().
GRANT SELECT ON comichuddle.fmv_quote_candidates TO comichuddle_valuator;
GRANT SELECT ON comichuddle.user_collections TO comichuddle_collector;
-- Seller declarations cannot promote themselves to VERIFIED or forge version/owner metadata.
GRANT INSERT(id,user_id,directory_id,physical_format,raw_condition,grade,grading_company,label_type,certification_number,
  comparable_attributes_key,purchase_price_cents,purchase_currency,private_notes,purchased_at,disposition,external_inventory_source,external_copy_id)
  ON comichuddle.user_collections TO comichuddle_collector;
GRANT UPDATE(directory_id,physical_format,raw_condition,grade,grading_company,label_type,certification_number,
  comparable_attributes_key,purchase_price_cents,purchase_currency,private_notes,purchased_at,disposition,external_inventory_source,external_copy_id)
  ON comichuddle.user_collections TO comichuddle_collector;
GRANT SELECT,INSERT,UPDATE ON comichuddle.marketplace_listings,comichuddle.listing_items TO comichuddle_collector;
GRANT INSERT(title,issue_number,publisher,variant_name,variant_code,series_start_year,created_by_user_id)
  ON comichuddle.directory_comics TO comichuddle_collector;
GRANT SELECT ON comichuddle.review_queue TO comichuddle_collector;
GRANT INSERT(directory_id,submitted_by_user_id,submission_evidence) ON comichuddle.review_queue TO comichuddle_collector;
GRANT EXECUTE ON FUNCTION comichuddle.create_custom_directory_entry(text,text,text,text,text,integer,jsonb,uuid) TO comichuddle_collector;
GRANT EXECUTE ON FUNCTION comichuddle.merge_custom_edition(uuid,uuid,bigint,bigint,uuid,uuid),
  comichuddle.approve_custom_edition(uuid,text,integer,bigint,uuid,uuid) TO comichuddle_moderator;
GRANT SELECT ON comichuddle.moderation_audit TO comichuddle_moderator;
-- Ingestion consumes approved supplier policy; it cannot grant itself licenses or verification.
GRANT SELECT ON comichuddle.valuation_sources TO comichuddle_ingest;
GRANT SELECT,INSERT,UPDATE ON comichuddle.valuation_sources TO comichuddle_moderator;
GRANT SELECT,INSERT ON comichuddle.fmv_history TO comichuddle_ingest;
GRANT SELECT ON comichuddle.directory_comics TO comichuddle_ingest;
GRANT SELECT ON comichuddle.marketplace_orders,comichuddle.order_items,comichuddle.marketplace_bids TO comichuddle_collector;
-- Commerce write flow remains an independently reviewed server integration, not buyer-side SQL.
GRANT SELECT,INSERT,UPDATE ON comichuddle.marketplace_orders,comichuddle.marketplace_bids TO comichuddle_commerce;
GRANT SELECT,INSERT ON comichuddle.order_items TO comichuddle_commerce;
GRANT SELECT ON comichuddle.marketplace_listings,comichuddle.listing_items,comichuddle.user_collections TO comichuddle_commerce;
GRANT UPDATE(status) ON comichuddle.marketplace_listings TO comichuddle_commerce;
GRANT UPDATE(reservation_active) ON comichuddle.listing_items TO comichuddle_commerce;
GRANT UPDATE(disposition) ON comichuddle.user_collections TO comichuddle_commerce;
GRANT SELECT ON comichuddle.directory_comics TO comichuddle_commerce;

CREATE FUNCTION comichuddle.is_admin_actor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,comichuddle,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM comichuddle.admin_memberships WHERE user_id=comichuddle.actor_user_id() AND active AND role IN ('MODERATOR','ADMIN'))
$$;
ALTER FUNCTION comichuddle.is_admin_actor() OWNER TO comichuddle_owner;
REVOKE ALL ON FUNCTION comichuddle.is_admin_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION comichuddle.is_admin_actor() TO comichuddle_moderator;
ALTER TABLE comichuddle.valuation_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_ingest_read ON comichuddle.valuation_sources FOR SELECT TO comichuddle_ingest USING (true);
CREATE POLICY source_moderator_read ON comichuddle.valuation_sources FOR SELECT TO comichuddle_moderator USING (comichuddle.is_admin_actor());
CREATE POLICY source_moderator_insert ON comichuddle.valuation_sources FOR INSERT TO comichuddle_moderator
  WITH CHECK (comichuddle.is_admin_actor() AND (verification_status<>'VERIFIED' OR reviewed_by_user_id=comichuddle.actor_user_id()));
CREATE POLICY source_moderator_update ON comichuddle.valuation_sources FOR UPDATE TO comichuddle_moderator
  USING (comichuddle.is_admin_actor())
  WITH CHECK (comichuddle.is_admin_actor() AND (verification_status<>'VERIFIED' OR reviewed_by_user_id=comichuddle.actor_user_id()));
ALTER TABLE comichuddle.fmv_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY quote_ingest_read ON comichuddle.fmv_history FOR SELECT TO comichuddle_ingest USING (true);
CREATE POLICY quote_ingest_insert ON comichuddle.fmv_history FOR INSERT TO comichuddle_ingest
  WITH CHECK (recorded_by_user_id=comichuddle.actor_user_id());
GRANT SELECT ON comichuddle.review_queue TO comichuddle_moderator;
CREATE POLICY directory_moderator_read ON comichuddle.directory_comics FOR SELECT TO comichuddle_moderator USING (comichuddle.is_admin_actor());
CREATE POLICY review_moderator_read ON comichuddle.review_queue FOR SELECT TO comichuddle_moderator USING (comichuddle.is_admin_actor());
-- This policy enables a separately authenticated commerce service to snapshot a sale it owns.
CREATE POLICY commerce_listing_read ON comichuddle.marketplace_listings FOR SELECT TO comichuddle_commerce USING (seller_id=comichuddle.actor_user_id());
CREATE POLICY commerce_listing_update ON comichuddle.marketplace_listings FOR UPDATE TO comichuddle_commerce USING (seller_id=comichuddle.actor_user_id()) WITH CHECK (seller_id=comichuddle.actor_user_id());
CREATE POLICY commerce_order_insert ON comichuddle.marketplace_orders FOR INSERT TO comichuddle_commerce WITH CHECK (seller_id=comichuddle.actor_user_id());
CREATE POLICY commerce_order_update ON comichuddle.marketplace_orders FOR UPDATE TO comichuddle_commerce USING (seller_id=comichuddle.actor_user_id()) WITH CHECK (seller_id=comichuddle.actor_user_id());
CREATE POLICY commerce_order_item_insert ON comichuddle.order_items FOR INSERT TO comichuddle_commerce WITH CHECK (seller_id=comichuddle.actor_user_id());
CREATE POLICY commerce_bid_insert ON comichuddle.marketplace_bids FOR INSERT TO comichuddle_commerce WITH CHECK (bidder_id=comichuddle.actor_user_id());
CREATE POLICY commerce_bid_update ON comichuddle.marketplace_bids FOR UPDATE TO comichuddle_commerce USING (bidder_id=comichuddle.actor_user_id()) WITH CHECK (bidder_id=comichuddle.actor_user_id());
COMMIT;
