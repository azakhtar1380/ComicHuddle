BEGIN;
CREATE TABLE ch_platform.catalog_moderation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comic_id uuid NOT NULL REFERENCES ch_platform.comics(id),
 submitted_by uuid NOT NULL REFERENCES ch_platform.users(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','merged','rejected')),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),reviewed_by uuid REFERENCES ch_platform.users(id),
 canonical_comic_id uuid REFERENCES ch_platform.comics(id),review_notes text,reviewed_at timestamptz,
 CHECK(status='pending' OR(reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX moderation_pending_idx ON ch_platform.catalog_moderation(id) WHERE status='pending';
CREATE TABLE ch_platform.legacy_identity_map (
 source_system text NOT NULL,entity_kind text NOT NULL CHECK(entity_kind IN ('user','comic','collection','physical_copy','listing')),
 legacy_id text NOT NULL,target_id uuid NOT NULL,content_hash char(64) NOT NULL,
 migrated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source_system,entity_kind,legacy_id)
);
CREATE INDEX legacy_target_idx ON ch_platform.legacy_identity_map(entity_kind,target_id);
CREATE TABLE ch_platform.migration_rejections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_system text NOT NULL,entity_kind text NOT NULL,legacy_id text NOT NULL,
 reason_code text NOT NULL,content_hash char(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_platform.fmv_record_sources (
 record_id uuid NOT NULL REFERENCES ch_platform.fmv_records(id),source_id text NOT NULL REFERENCES ch_platform.data_sources(id),
 rights_reference text NOT NULL,PRIMARY KEY(record_id,source_id)
);
CREATE INDEX quote_sources_source_idx ON ch_platform.fmv_record_sources(source_id,record_id);
CREATE TRIGGER immutable_quote_sources BEFORE UPDATE OR DELETE ON ch_platform.fmv_record_sources FOR EACH ROW EXECUTE FUNCTION ch_platform.reject_history_mutation();
GRANT SELECT,INSERT ON ch_platform.fmv_record_sources TO ch_platform_service;
-- Canonicalization updates a live copy and its listing FK in one transaction.
ALTER TABLE ch_platform.listing_items ALTER CONSTRAINT listing_items_collection_item_id_seller_id_comic_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
GRANT SELECT,INSERT,UPDATE,DELETE ON ch_platform.catalog_moderation,ch_platform.legacy_identity_map,ch_platform.migration_rejections TO ch_platform_service;
COMMIT;
BEGIN;
CREATE TABLE ch_platform.return_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES ch_platform.orders(id),
 status text NOT NULL CHECK(status IN ('recovery_reserved','reversed','refund_pending','refunded','needs_reconciliation')),
 inspection_asset_id uuid NOT NULL,approved_by uuid NOT NULL REFERENCES ch_platform.users(id),
 recovery_cents bigint NOT NULL CHECK(recovery_cents>0),provider_transfer_id text NOT NULL,
 provider_reversal_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE ON ch_platform.return_cases TO ch_platform_service;
CREATE UNIQUE INDEX quote_evidence_once_idx ON ch_platform.fmv_records(comic_id,grade_key,evidence_hash);
COMMIT;
