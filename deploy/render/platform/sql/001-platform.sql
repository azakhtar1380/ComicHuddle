-- ComicHuddle platform v2. PostgreSQL 16+; additive, isolated namespace.
-- This does not migrate or replace the deployed Cloudflare D1 database.
-- Apply once in a reviewed migration transaction. Money is integer USD cents.
BEGIN;
CREATE SCHEMA ch_platform;

CREATE TABLE ch_platform.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject text NOT NULL UNIQUE,
 display_name text NOT NULL, country char(2) NOT NULL DEFAULT 'US' CHECK(country='US'),
 connected_account_id text UNIQUE, payouts_enabled boolean NOT NULL DEFAULT false,
 role text NOT NULL DEFAULT 'collector' CHECK(role IN ('collector','presser','admin','vault_operator')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(length(subject) BETWEEN 1 AND 256)
);
CREATE TABLE ch_platform.publishers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 slug text NOT NULL UNIQUE, country char(2), source_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), publisher_id uuid NOT NULL REFERENCES ch_platform.publishers(id),
 title text NOT NULL, start_year smallint NOT NULL CHECK(start_year BETWEEN 1800 AND 2200),
 language text NOT NULL DEFAULT 'en', volume text NOT NULL DEFAULT '',
 UNIQUE(publisher_id,title,start_year,language,volume)
);
CREATE INDEX series_publisher_idx ON ch_platform.series(publisher_id);
CREATE INDEX series_title_search_idx ON ch_platform.series USING gin(to_tsvector('english',title));
CREATE TABLE ch_platform.comics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), series_id uuid NOT NULL REFERENCES ch_platform.series(id),
 issue_number text NOT NULL CHECK(length(issue_number) BETWEEN 1 AND 50), issue_title text NOT NULL DEFAULT '',
 publication_date date, printing_type text NOT NULL DEFAULT 'unknown'
  CHECK(printing_type IN ('1st_print','2nd_print','later_print','facsimile','reprint','unknown')),
 printing_number smallint CHECK(printing_number>0), variant_code text NOT NULL DEFAULT 'standard',
 barcode text, original_cover_price_text text, metadata_status text NOT NULL DEFAULT 'provisional'
  CHECK(metadata_status IN ('canonical','provisional','aliased')),
 alias_of uuid REFERENCES ch_platform.comics(id), created_by uuid REFERENCES ch_platform.users(id),
 source text NOT NULL, source_id text, source_url text NOT NULL, attribution text NOT NULL,
 license_name text NOT NULL, version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((metadata_status='aliased')=(alias_of IS NOT NULL)), CHECK(alias_of IS DISTINCT FROM id),
 UNIQUE NULLS NOT DISTINCT(series_id,issue_number,printing_type,printing_number,variant_code), UNIQUE(source,source_id)
);
CREATE INDEX comics_series_idx ON ch_platform.comics(series_id,publication_date DESC);
CREATE INDEX comics_barcode_idx ON ch_platform.comics(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX comics_metadata_idx ON ch_platform.comics(metadata_status,updated_at DESC);
CREATE TABLE ch_platform.variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), comic_id uuid NOT NULL UNIQUE REFERENCES ch_platform.comics(id),
 name text NOT NULL, cover_artist text, ratio_numerator integer CHECK(ratio_numerator>0),
 ratio_denominator integer CHECK(ratio_denominator>0), evidence_url text, verified_at timestamptz,
 CHECK((ratio_numerator IS NULL)=(ratio_denominator IS NULL)),
 CHECK(ratio_numerator IS NULL OR (evidence_url IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE TABLE ch_platform.characters (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE);
CREATE TABLE ch_platform.comic_characters (
 comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),character_id uuid NOT NULL REFERENCES ch_platform.characters(id),
 PRIMARY KEY(comic_id,character_id)
);
CREATE INDEX character_comics_idx ON ch_platform.comic_characters(character_id,comic_id);
CREATE TABLE ch_platform.key_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text NOT NULL UNIQUE,name text NOT NULL,description text NOT NULL
);
CREATE TABLE ch_platform.comic_keys (
 comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),category_id uuid NOT NULL REFERENCES ch_platform.key_categories(id),
 character_id uuid REFERENCES ch_platform.characters(id),claim text NOT NULL,evidence_url text NOT NULL,
 verification_status text NOT NULL DEFAULT 'unreviewed' CHECK(verification_status IN ('unreviewed','verified','disputed')),
 verified_by uuid REFERENCES ch_platform.users(id),verified_at timestamptz,
 PRIMARY KEY(comic_id,category_id),CHECK(verification_status<>'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX keys_category_idx ON ch_platform.comic_keys(category_id,verification_status,comic_id);
CREATE TABLE ch_platform.comic_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),
 url text NOT NULL CHECK(url LIKE 'https://%'),sha256 char(64) NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('cover','barcode','indicia','back','detail')),
 rights_basis text NOT NULL,rights_reference text NOT NULL,display_allowed boolean NOT NULL DEFAULT false,
 recognition_allowed boolean NOT NULL DEFAULT false,license_expires_at timestamptz,
 width integer NOT NULL CHECK(width>0),height integer NOT NULL CHECK(height>0), UNIQUE(comic_id,sha256,kind)
);
CREATE INDEX images_comic_idx ON ch_platform.comic_images(comic_id,kind);
CREATE TABLE ch_platform.grade_profiles (
 key text PRIMARY KEY,format text NOT NULL CHECK(format IN ('raw','graded')),
 raw_condition text,grader text,grade numeric(3,1),label text,attributes_key text NOT NULL DEFAULT 'standard',
 CHECK((format='raw' AND raw_condition IS NOT NULL AND grader IS NULL AND grade IS NULL AND label IS NULL)
  OR(format='graded' AND raw_condition IS NULL AND grader IS NOT NULL AND grade>0 AND grade<=10 AND label IS NOT NULL))
);
INSERT INTO ch_platform.grade_profiles(key,format,raw_condition) VALUES
 ('raw_unknown','raw','UNKNOWN'),('raw_g','raw','G'),('raw_vg','raw','VG'),('raw_fn','raw','FN'),('raw_vf','raw','VF'),('raw_nm','raw','NM');
INSERT INTO ch_platform.grade_profiles(key,format,grader,grade,label) VALUES
 ('cgc_9_2_universal','graded','CGC',9.2,'Universal'),('cgc_9_4_universal','graded','CGC',9.4,'Universal'),
 ('cgc_9_6_universal','graded','CGC',9.6,'Universal'),('cgc_9_8_universal','graded','CGC',9.8,'Universal');
CREATE TABLE ch_platform.data_sources (
 id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('sold','licensed_fmv','asking')),
 enabled boolean NOT NULL DEFAULT false,display_rights boolean NOT NULL DEFAULT false,
 license_reference text,license_expires_at timestamptz,attribution text NOT NULL,
 max_age_days integer NOT NULL DEFAULT 30 CHECK(max_age_days BETWEEN 1 AND 366),
 updated_by uuid REFERENCES ch_platform.users(id),version bigint NOT NULL DEFAULT 1
);
INSERT INTO ch_platform.data_sources(id,kind,attribution) VALUES
 ('ebay_insights','sold','eBay'),('licensed_feed','licensed_fmv','Licensed provider'),
 ('internal_platform','sold','Verified ComicHuddle transactions'),('ebay_browse','asking','eBay active asking prices');
CREATE TABLE ch_platform.fmv_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),
 grade_key text NOT NULL REFERENCES ch_platform.grade_profiles(key),source_id text NOT NULL REFERENCES ch_platform.data_sources(id),
 quote_kind text NOT NULL CHECK(quote_kind IN ('sold_estimate','licensed_fmv','asking_range','editorial_estimate')),
 value_cents bigint CHECK(value_cents BETWEEN 1 AND 9007199254740991),
 low_cents bigint NOT NULL CHECK(low_cents>0),high_cents bigint NOT NULL CHECK(high_cents>=low_cents),
 currency char(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'),sample_count integer NOT NULL CHECK(sample_count>=1),
 observed_at timestamptz NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 methodology text NOT NULL,confidence text NOT NULL CHECK(confidence IN ('low','medium','high')),
 rights_reference text NOT NULL,evidence_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(value_cents BETWEEN low_cents AND high_cents),CHECK((quote_kind='asking_range')=(value_cents IS NULL)),
 CHECK(window_start<=window_end AND window_end<=observed_at),CHECK(grade_key<>'raw_unknown'),
 CHECK(observed_at<=created_at+interval '5 minutes')
);
CREATE INDEX fmv_exact_latest_idx ON ch_platform.fmv_records(comic_id,grade_key,currency,observed_at DESC);
CREATE INDEX fmv_source_idx ON ch_platform.fmv_records(source_id,observed_at DESC);
CREATE TABLE ch_platform.ebay_comps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),
 grade_key text NOT NULL REFERENCES ch_platform.grade_profiles(key),external_sale_id text NOT NULL UNIQUE,
 source_id text NOT NULL REFERENCES ch_platform.data_sources(id),sold_at timestamptz NOT NULL,
 actual_price_cents bigint CHECK(actual_price_cents>0),shipping_cents bigint CHECK(shipping_cents>=0),
 currency char(3) NOT NULL CHECK(currency='USD'),condition_text text NOT NULL,
 best_offer_accepted boolean NOT NULL DEFAULT false,actual_accepted_price_known boolean NOT NULL DEFAULT false,
 verified boolean NOT NULL DEFAULT false,is_bundle boolean NOT NULL DEFAULT false,
 source_url text NOT NULL,rights_reference text NOT NULL,evidence_hash char(64) NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),CHECK(actual_price_cents IS NULL OR actual_price_cents<=9007199254740991),
 CHECK(NOT best_offer_accepted OR actual_accepted_price_known OR actual_price_cents IS NULL)
);
CREATE INDEX comps_exact_idx ON ch_platform.ebay_comps(comic_id,grade_key,sold_at DESC) WHERE verified AND NOT is_bundle;
CREATE TABLE ch_platform.cgc_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),
 certification_number text UNIQUE CHECK(certification_number~'^[0-9]{6,20}$'),
 grade numeric(3,1) CHECK(grade>0 AND grade<=10),label text,
 census_count bigint CHECK(census_count>=0),source_url text NOT NULL,record_kind text NOT NULL CHECK(record_kind IN ('certificate','census')),
 observed_at timestamptz NOT NULL,verified_by uuid REFERENCES ch_platform.users(id),
 CHECK((record_kind='certificate' AND certification_number IS NOT NULL AND grade IS NOT NULL)
  OR(record_kind='census' AND census_count IS NOT NULL))
);
CREATE INDEX cgc_comic_idx ON ch_platform.cgc_records(comic_id,observed_at DESC);
CREATE TABLE ch_platform.user_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES ch_platform.users(id),name text NOT NULL,
 is_public boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,user_id)
);
CREATE INDEX collections_owner_idx ON ch_platform.user_collections(user_id);
CREATE TABLE ch_platform.collection_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),collection_id uuid NOT NULL,user_id uuid NOT NULL,
 comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),grade_key text NOT NULL REFERENCES ch_platform.grade_profiles(key),
 certification_number text CHECK(certification_number~'^[0-9]{6,20}$'),purchase_price_cents bigint CHECK(purchase_price_cents>=0),
 purchased_at date,condition_notes text NOT NULL DEFAULT '',private_notes text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','sold','removed')),
 FOREIGN KEY(collection_id,user_id) REFERENCES ch_platform.user_collections(id,user_id),UNIQUE(id,user_id),UNIQUE(id,user_id,comic_id),
 CHECK(length(private_notes)<=2000)
);
CREATE INDEX items_owner_idx ON ch_platform.collection_items(user_id,collection_id,status);
CREATE INDEX items_comic_idx ON ch_platform.collection_items(comic_id);
CREATE UNIQUE INDEX held_certificate_idx ON ch_platform.collection_items(user_id,certification_number)
 WHERE certification_number IS NOT NULL AND status='held';
CREATE TABLE ch_platform.marketplace_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seller_id uuid NOT NULL REFERENCES ch_platform.users(id),
 comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),is_custom_entry boolean NOT NULL DEFAULT false,
 kind text NOT NULL CHECK(kind IN ('single','collection')),sale_mode text NOT NULL CHECK(sale_mode IN ('fixed','auction','trade')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','under_review','active','reserved','sold','cancelled')),
 title text NOT NULL,asking_price_cents bigint NOT NULL CHECK(asking_price_cents>0 AND asking_price_cents<=9007199254740991),
 currency char(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'),version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,seller_id)
);
CREATE INDEX listings_active_idx ON ch_platform.marketplace_listings(comic_id,created_at DESC) WHERE status='active';
CREATE INDEX listings_seller_idx ON ch_platform.marketplace_listings(seller_id,status);
CREATE TABLE ch_platform.listing_items (
 listing_id uuid NOT NULL,seller_id uuid NOT NULL,collection_item_id uuid NOT NULL,comic_id uuid NOT NULL,
 reserved boolean NOT NULL DEFAULT false,
 PRIMARY KEY(listing_id,collection_item_id),FOREIGN KEY(listing_id,seller_id) REFERENCES ch_platform.marketplace_listings(id,seller_id),
 FOREIGN KEY(collection_item_id,seller_id,comic_id) REFERENCES ch_platform.collection_items(id,user_id,comic_id)
);
CREATE UNIQUE INDEX one_reservation_per_copy ON ch_platform.listing_items(collection_item_id) WHERE reserved;
CREATE INDEX listing_items_copy_idx ON ch_platform.listing_items(collection_item_id,seller_id,comic_id);
CREATE TABLE ch_platform.ai_authenticity_scans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES ch_platform.users(id),
 collection_item_id uuid REFERENCES ch_platform.collection_items(id),comic_id uuid REFERENCES ch_platform.comics(id),
 printing_type text NOT NULL CHECK(printing_type IN ('1st_print','2nd_print','later_print','facsimile','reprint','unknown')),
 confidence_score numeric(5,4) NOT NULL CHECK(confidence_score BETWEEN 0 AND 1),
 flagged_anomalies jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(flagged_anomalies)='array'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),model_version text NOT NULL,
 photo_hashes text[] NOT NULL CHECK(cardinality(photo_hashes)>0),
 disposition text NOT NULL CHECK(disposition IN ('inconclusive','edition_candidate','needs_review','human_verified','rejected')),
 reviewed_by uuid REFERENCES ch_platform.users(id),reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(disposition NOT IN ('human_verified','rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX scans_owner_idx ON ch_platform.ai_authenticity_scans(user_id,created_at DESC);
CREATE INDEX scans_review_idx ON ch_platform.ai_authenticity_scans(disposition,created_at) WHERE disposition='needs_review';
CREATE TABLE ch_platform.listing_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),listing_id uuid NOT NULL REFERENCES ch_platform.marketplace_listings(id),
 collection_item_id uuid NOT NULL REFERENCES ch_platform.collection_items(id),asset_id uuid NOT NULL,
 url text NOT NULL CHECK(url LIKE 'https://%'),sha256 char(64) NOT NULL,scan_id uuid REFERENCES ch_platform.ai_authenticity_scans(id),
 kind text NOT NULL CHECK(kind IN ('cover','back','barcode','indicia','slab','detail')), UNIQUE(listing_id,collection_item_id,sha256)
);
CREATE INDEX photos_listing_idx ON ch_platform.listing_photos(listing_id,collection_item_id);
CREATE TABLE ch_platform.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),listing_id uuid NOT NULL REFERENCES ch_platform.marketplace_listings(id),
 buyer_id uuid NOT NULL REFERENCES ch_platform.users(id),seller_id uuid NOT NULL REFERENCES ch_platform.users(id),
 subtotal_cents bigint NOT NULL CHECK(subtotal_cents>0),shipping_cents bigint NOT NULL DEFAULT 0 CHECK(shipping_cents>=0),
 tax_cents bigint NOT NULL DEFAULT 0 CHECK(tax_cents>=0),platform_fee_cents bigint NOT NULL DEFAULT 0 CHECK(platform_fee_cents>=0),
 discount_cents bigint NOT NULL DEFAULT 0 CHECK(discount_cents>=0),currency char(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 status text NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','payment_preparing','paid','fulfilled','refunding','refunded','cancelled','disputed')),
 payment_intent_id text UNIQUE,charge_id text UNIQUE,dispute_open boolean NOT NULL DEFAULT false,
 confirmed_delivery_at timestamptz,return_window_ends_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(buyer_id<>seller_id),CHECK(platform_fee_cents<=subtotal_cents),CHECK(discount_cents<=platform_fee_cents),CHECK(subtotal_cents-discount_cents+shipping_cents+tax_cents>0),
 CHECK(subtotal_cents+shipping_cents+tax_cents<=9007199254740991),UNIQUE(id,buyer_id,seller_id)
);
CREATE UNIQUE INDEX one_open_order_idx ON ch_platform.orders(listing_id) WHERE status NOT IN ('refunded','cancelled');
CREATE INDEX orders_buyer_idx ON ch_platform.orders(buyer_id,created_at DESC);
CREATE INDEX orders_seller_idx ON ch_platform.orders(seller_id,created_at DESC);
CREATE TABLE ch_platform.order_items (
 order_id uuid NOT NULL REFERENCES ch_platform.orders(id),collection_item_id uuid NOT NULL REFERENCES ch_platform.collection_items(id),
 comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),grade_key text NOT NULL REFERENCES ch_platform.grade_profiles(key),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),PRIMARY KEY(order_id,collection_item_id)
);
CREATE INDEX order_items_comic_idx ON ch_platform.order_items(comic_id);
CREATE TABLE ch_platform.escrow_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES ch_platform.orders(id),
 requires_vault boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'pending_deposit' CHECK(status IN ('pending_deposit','funded','seller_shipped','received_at_vault','inspected','inspection_failed','shipped_to_buyer','delivered','release_pending','completed','disputed','refund_pending','refunded','cancelled')),
 threshold_cents bigint NOT NULL CHECK(threshold_cents>0),inspection_id uuid,inspection_passed boolean,
 seller_tracking text,buyer_tracking text,seller_carrier text,buyer_carrier text,
 seller_ship_by timestamptz,received_at_vault_at timestamptz,inspected_at timestamptz,
 inspection_report jsonb,provider_transfer_id text UNIQUE,provider_refund_id text UNIQUE,
 version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 CHECK(status<>'completed' OR (provider_transfer_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX escrow_work_queue_idx ON ch_platform.escrow_transactions(status,seller_ship_by);
CREATE TABLE ch_platform.escrow_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid NOT NULL REFERENCES ch_platform.escrow_transactions(id),
 event text NOT NULL,from_status text NOT NULL,to_status text NOT NULL,
 actor_user_id uuid REFERENCES ch_platform.users(id),evidence jsonb NOT NULL,idempotency_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.user_wallets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE REFERENCES ch_platform.users(id),
 currency char(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 product_kind text NOT NULL DEFAULT 'seller_payables' CHECK(product_kind='seller_payables'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.ledger_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid REFERENCES ch_platform.user_wallets(id),
 code text NOT NULL UNIQUE,kind text NOT NULL CHECK(kind IN ('provider_clearing','order_hold','seller_available','seller_reserved','platform_revenue','reward_expense','tax_payable','shipping_reserve')),
 normal_side text NOT NULL CHECK(normal_side IN ('debit','credit')),currency char(3) NOT NULL CHECK(currency='USD')
);
CREATE INDEX accounts_wallet_idx ON ch_platform.ledger_accounts(wallet_id);
CREATE TABLE ch_platform.wallet_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid REFERENCES ch_platform.user_wallets(id),
 order_id uuid REFERENCES ch_platform.orders(id),kind text NOT NULL,
 idempotency_key text NOT NULL UNIQUE,request_hash char(64) NOT NULL,
 provider_reference text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_history_idx ON ch_platform.wallet_transactions(wallet_id,created_at DESC);
CREATE INDEX wallet_order_idx ON ch_platform.wallet_transactions(order_id);
CREATE TABLE ch_platform.ledger_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid NOT NULL REFERENCES ch_platform.wallet_transactions(id),
 account_id uuid NOT NULL REFERENCES ch_platform.ledger_accounts(id),side text NOT NULL CHECK(side IN ('debit','credit')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_balance_idx ON ch_platform.ledger_entries(account_id,transaction_id);
CREATE TABLE ch_platform.withdrawals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid NOT NULL REFERENCES ch_platform.user_wallets(id),
 user_id uuid NOT NULL REFERENCES ch_platform.users(id),amount_cents bigint NOT NULL CHECK(amount_cents>0),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','submitted','paid','failed','needs_reconciliation')),
 idempotency_key text NOT NULL UNIQUE,request_hash char(64) NOT NULL,provider_payout_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX withdrawals_wallet_idx ON ch_platform.withdrawals(wallet_id,created_at DESC);
CREATE TABLE ch_platform.reward_points_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES ch_platform.users(id),
 order_id uuid REFERENCES ch_platform.orders(id),listing_id uuid REFERENCES ch_platform.marketplace_listings(id),
 points bigint NOT NULL CHECK(points<>0),kind text NOT NULL CHECK(kind IN ('earned_purchase','earned_listing','redeemed','reversed','restored','expired')),
 idempotency_key text NOT NULL UNIQUE,reference_id uuid,expires_at timestamptz,
 policy_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind IN ('earned_purchase','earned_listing','restored') AND points>0) OR (kind IN ('redeemed','reversed','expired') AND points<0))
);
CREATE INDEX points_owner_idx ON ch_platform.reward_points_ledger(user_id,created_at DESC);
CREATE UNIQUE INDEX reward_once_order_idx ON ch_platform.reward_points_ledger(user_id,order_id,kind) WHERE kind='earned_purchase';
CREATE UNIQUE INDEX reward_once_listing_idx ON ch_platform.reward_points_ledger(user_id,listing_id,kind) WHERE kind='earned_listing';
CREATE TABLE ch_platform.reward_redemptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES ch_platform.users(id),
 order_id uuid NOT NULL UNIQUE REFERENCES ch_platform.orders(id),points bigint NOT NULL CHECK(points>0),
 discount_cents bigint NOT NULL CHECK(discount_cents>0),status text NOT NULL CHECK(status IN ('reserved','applied','restored')),
 idempotency_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.listing_reward_claims (
 user_id uuid NOT NULL REFERENCES ch_platform.users(id),collection_item_id uuid NOT NULL REFERENCES ch_platform.collection_items(id),
 listing_id uuid NOT NULL REFERENCES ch_platform.marketplace_listings(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,collection_item_id)
);
CREATE TABLE ch_platform.provider_events (
 provider text NOT NULL,event_id text NOT NULL,payload_hash char(64) NOT NULL,
 object_id text NOT NULL,event_type text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','failed')),
 received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(provider,event_id)
);
CREATE TABLE ch_platform.operation_requests (
 key text PRIMARY KEY,kind text NOT NULL,request_hash char(64) NOT NULL,result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.outbox_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,aggregate_id uuid NOT NULL,
 operation_key text NOT NULL UNIQUE,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','succeeded','failed','needs_reconciliation')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),available_at timestamptz NOT NULL DEFAULT now(),
 lease_owner uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),last_error_code text
);
CREATE INDEX outbox_ready_idx ON ch_platform.outbox_jobs(available_at,created_at) WHERE status IN ('pending','leased');
CREATE TABLE ch_platform.ebay_oauth_sessions (
 state_hash char(64) PRIMARY KEY,user_id uuid NOT NULL REFERENCES ch_platform.users(id),
 browser_session_hash char(64) NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
 pkce_verifier_ciphertext text -- reserved only; eBay does not document PKCE for this confidential-client grant.
);
CREATE TABLE ch_platform.ebay_connections (
 user_id uuid PRIMARY KEY REFERENCES ch_platform.users(id),ebay_user_id text NOT NULL UNIQUE,
 access_token_ciphertext text NOT NULL,refresh_token_ciphertext text NOT NULL,
 expires_at timestamptz NOT NULL,scopes text[] NOT NULL,connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.ebay_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES ch_platform.users(id),
 internal_listing_id uuid NOT NULL REFERENCES ch_platform.marketplace_listings(id),
 comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),collection_id uuid REFERENCES ch_platform.user_collections(id),
 ebay_sku text NOT NULL,ebay_offer_id text UNIQUE,ebay_listing_id text UNIQUE,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','draft_pending','unpublished_offer','publish_pending','live','ended','error','needs_reconciliation')),
 baseline_fmv_record_id uuid REFERENCES ch_platform.fmv_records(id),baseline_fmv_cents bigint CHECK(baseline_fmv_cents>0),
 baseline_kind text CHECK(baseline_kind IN ('sold_estimate','licensed_fmv','asking_range')),
 draft_payload jsonb,draft_hash char(64),draft_inventory_hash char(64),draft_created_at timestamptz,provider_revision text,available_quantity integer NOT NULL DEFAULT 1 CHECK(available_quantity>=0),
 observed_price_cents bigint CHECK(observed_price_cents>0),last_synced_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,ebay_sku),UNIQUE(internal_listing_id)
);
CREATE INDEX ebay_listing_owner_idx ON ch_platform.ebay_listings(user_id,status);
CREATE TABLE ch_platform.ebay_operations (
 idempotency_key text PRIMARY KEY,listing_id uuid NOT NULL REFERENCES ch_platform.ebay_listings(id),
 operation text NOT NULL CHECK(operation IN ('upsert_inventory','create_offer','publish','end','revise')),
 request_hash char(64) NOT NULL,status text NOT NULL CHECK(status IN ('pending','sent','confirmed','ambiguous','failed')),
 result jsonb,created_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable money/evidence. Fixes are new compensating entries, never overwritten history.
CREATE FUNCTION ch_platform.reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only record' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['fmv_records','ebay_comps','wallet_transactions','ledger_entries','reward_points_ledger','escrow_events','order_items'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON ch_platform.%I FOR EACH ROW EXECUTE FUNCTION ch_platform.reject_history_mutation()',t);
 END LOOP;
END $$;
CREATE FUNCTION ch_platform.check_balanced_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tx uuid; n integer; balance numeric;
BEGIN
 IF TG_TABLE_NAME='wallet_transactions' THEN tx:=NEW.id; ELSE tx:=NEW.transaction_id; END IF;
 SELECT count(*),coalesce(sum(CASE WHEN side='debit' THEN amount_cents ELSE -amount_cents END),0)
  INTO n,balance FROM ch_platform.ledger_entries WHERE transaction_id=tx;
 IF n<2 OR balance<>0 THEN RAISE EXCEPTION 'Unbalanced ledger transaction' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transaction_balance AFTER INSERT ON ch_platform.wallet_transactions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ch_platform.check_balanced_transaction();
CREATE CONSTRAINT TRIGGER entries_balance AFTER INSERT ON ch_platform.ledger_entries DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ch_platform.check_balanced_transaction();
CREATE FUNCTION ch_platform.check_nonnegative_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE normal text; kind text; balance numeric;
BEGIN
 SELECT a.normal_side,a.kind INTO normal,kind FROM ch_platform.ledger_accounts a WHERE a.id=NEW.account_id FOR UPDATE;
 IF kind NOT IN ('seller_available','seller_reserved','order_hold') THEN RETURN NULL; END IF;
 SELECT coalesce(sum(CASE WHEN side=normal THEN amount_cents ELSE -amount_cents END),0) INTO balance
 FROM ch_platform.ledger_entries WHERE account_id=NEW.account_id;
 IF balance<0 THEN RAISE EXCEPTION 'Insufficient available funds' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER nonnegative_account AFTER INSERT ON ch_platform.ledger_entries DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ch_platform.check_nonnegative_account();
CREATE FUNCTION ch_platform.check_listing_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid uuid; h ch_platform.marketplace_listings; n integer; custom boolean; anchor boolean;
BEGIN
 IF TG_TABLE_NAME='marketplace_listings' THEN lid:=NEW.id; ELSIF TG_OP='DELETE' THEN lid:=OLD.listing_id; ELSE lid:=NEW.listing_id; END IF;
 SELECT * INTO h FROM ch_platform.marketplace_listings WHERE id=lid FOR UPDATE;
 SELECT count(*),coalesce(bool_or(c.metadata_status<>'canonical'),false),coalesce(bool_or(i.comic_id=h.comic_id),false)
 INTO n,custom,anchor FROM ch_platform.listing_items i JOIN ch_platform.comics c ON c.id=i.comic_id WHERE i.listing_id=lid;
 IF h.status IN ('active','reserved','sold') THEN
  IF n=0 OR NOT anchor OR custom OR h.is_custom_entry OR(h.kind='single' AND n<>1) THEN
   RAISE EXCEPTION 'Exact canonical listing items required' USING ERRCODE='23514'; END IF;
 END IF;
 IF n>0 AND h.is_custom_entry<>custom THEN RAISE EXCEPTION 'Custom status mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ch_platform.listing_items WHERE listing_id=lid AND reserved<>(h.status IN ('active','reserved'))) THEN
  RAISE EXCEPTION 'Reservation status mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER listing_integrity AFTER INSERT OR UPDATE ON ch_platform.marketplace_listings DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ch_platform.check_listing_integrity();
CREATE CONSTRAINT TRIGGER listing_items_integrity AFTER INSERT OR UPDATE OR DELETE ON ch_platform.listing_items DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ch_platform.check_listing_integrity();
CREATE FUNCTION ch_platform.check_points_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total numeric;
BEGIN
 PERFORM 1 FROM ch_platform.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT coalesce(sum(points),0) INTO total FROM ch_platform.reward_points_ledger WHERE user_id=NEW.user_id;
 -- Refund reversals may create points debt. New redemptions cannot deepen debt.
 IF NEW.kind='redeemed' AND total<0 THEN RAISE EXCEPTION 'Insufficient points' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER points_balance AFTER INSERT ON ch_platform.reward_points_ledger DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ch_platform.check_points_balance();

CREATE FUNCTION ch_platform.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
ALTER TABLE ch_platform.user_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.reward_points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.ai_authenticity_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.ebay_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.ebay_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_platform.ebay_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_collection ON ch_platform.user_collections USING(user_id=ch_platform.actor_id()) WITH CHECK(user_id=ch_platform.actor_id());
CREATE POLICY own_items ON ch_platform.collection_items USING(user_id=ch_platform.actor_id()) WITH CHECK(user_id=ch_platform.actor_id());
CREATE POLICY own_wallet ON ch_platform.user_wallets FOR SELECT USING(user_id=ch_platform.actor_id());
CREATE POLICY own_wallet_history ON ch_platform.wallet_transactions FOR SELECT USING(wallet_id IN(SELECT id FROM ch_platform.user_wallets WHERE user_id=ch_platform.actor_id()));
CREATE POLICY own_points ON ch_platform.reward_points_ledger FOR SELECT USING(user_id=ch_platform.actor_id());
CREATE POLICY own_withdrawals ON ch_platform.withdrawals FOR SELECT USING(user_id=ch_platform.actor_id());
CREATE POLICY own_scans ON ch_platform.ai_authenticity_scans FOR SELECT USING(user_id=ch_platform.actor_id());
CREATE POLICY own_ebay_listing ON ch_platform.ebay_listings FOR SELECT USING(user_id=ch_platform.actor_id());
-- Token/session tables have no public policies or browser grants.
COMMIT;
