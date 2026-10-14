-- ComicHuddle PostgreSQL 18 reference. NOT a migration for the deployed D1 database.
-- Run on an empty database as a dedicated schema owner. No extension is required.
BEGIN;
CREATE SCHEMA comichuddle;

CREATE TABLE comichuddle.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject text NOT NULL UNIQUE CHECK (length(btrim(external_subject)) BETWEEN 1 AND 200),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comichuddle.admin_memberships (
  user_id uuid PRIMARY KEY REFERENCES comichuddle.users(id),
  role text NOT NULL CHECK (role IN ('MODERATOR','ADMIN')),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE comichuddle.directory_comics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  issue_number text NOT NULL CHECK (length(btrim(issue_number)) BETWEEN 1 AND 80),
  publisher text NOT NULL CHECK (length(btrim(publisher)) BETWEEN 1 AND 160),
  series_start_year integer CHECK (series_start_year BETWEEN 1800 AND 9999),
  variant_name text NOT NULL DEFAULT 'Standard' CHECK (length(btrim(variant_name)) BETWEEN 1 AND 200),
  variant_code text NOT NULL DEFAULT 'standard' CHECK (length(btrim(variant_code)) BETWEEN 1 AND 160),
  printing integer NOT NULL DEFAULT 1 CHECK (printing > 0),
  language_code text NOT NULL DEFAULT 'en' CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  publication_date date,
  status text NOT NULL DEFAULT 'PROVISIONAL' CHECK (status IN ('PROVISIONAL','CANONICAL','ALIASED')),
  canonical_edition_key text UNIQUE CHECK (canonical_edition_key IS NULL OR length(btrim(canonical_edition_key)) BETWEEN 1 AND 240),
  redirect_directory_id uuid REFERENCES comichuddle.directory_comics(id),
  created_by_user_id uuid NOT NULL REFERENCES comichuddle.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'ALIASED' AND redirect_directory_id IS NOT NULL AND redirect_directory_id <> id)
      OR (status <> 'ALIASED' AND redirect_directory_id IS NULL)),
  CHECK (status <> 'CANONICAL' OR (canonical_edition_key IS NOT NULL AND series_start_year IS NOT NULL))
);
CREATE UNIQUE INDEX canonical_edition_identity ON comichuddle.directory_comics
  (lower(btrim(publisher)), lower(btrim(title)), series_start_year,
   lower(btrim(issue_number)), lower(btrim(variant_code)), printing, language_code)
  WHERE status = 'CANONICAL';
CREATE INDEX directory_creator_idx ON comichuddle.directory_comics(created_by_user_id);
CREATE INDEX directory_redirect_idx ON comichuddle.directory_comics(redirect_directory_id);
CREATE INDEX directory_search_idx ON comichuddle.directory_comics USING gin
  (to_tsvector('simple', title || ' ' || issue_number || ' ' || publisher || ' ' || variant_name));

CREATE TABLE comichuddle.valuation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (length(btrim(code)) BETWEEN 1 AND 100),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  public_attribution text NOT NULL DEFAULT 'Source attribution pending' CHECK (length(btrim(public_attribution)) BETWEEN 1 AND 300),
  public_methodology text NOT NULL DEFAULT 'Methodology not supplied' CHECK (length(btrim(public_methodology)) BETWEEN 1 AND 1000),
  source_kind text NOT NULL CHECK (source_kind IN ('LICENSED_SALES','VERIFIED_SALES','EDITORIAL','UNVERIFIED')),
  verification_status text NOT NULL CHECK (verification_status IN ('VERIFIED','UNVERIFIED')),
  license_status text NOT NULL CHECK (license_status IN ('CURRENT','EXPIRED','ABSENT')),
  commercial_display_permitted boolean NOT NULL DEFAULT false,
  license_reference text NOT NULL DEFAULT '' CHECK (length(license_reference) <= 1000),
  license_valid_until timestamptz,
  max_age_hours integer NOT NULL DEFAULT 168 CHECK (max_age_hours BETWEEN 1 AND 8760),
  minimum_sample_count integer NOT NULL DEFAULT 3 CHECK (minimum_sample_count BETWEEN 1 AND 1000000),
  provenance_uri text NOT NULL CHECK (length(btrim(provenance_uri)) BETWEEN 1 AND 2000),
  reviewed_by_user_id uuid REFERENCES comichuddle.users(id),
  reviewed_at timestamptz,
  CHECK (license_status <> 'CURRENT' OR
    (license_valid_until IS NOT NULL AND length(btrim(license_reference)) > 0)),
  CHECK (verification_status <> 'VERIFIED' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX valuation_source_reviewer_idx ON comichuddle.valuation_sources(reviewed_by_user_id);

CREATE TABLE comichuddle.directory_provider_crosswalk (
  source_id uuid NOT NULL REFERENCES comichuddle.valuation_sources(id),
  external_edition_id text NOT NULL CHECK (length(btrim(external_edition_id)) BETWEEN 1 AND 240),
  directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  evidence_uri text NOT NULL CHECK (length(btrim(evidence_uri)) > 0),
  PRIMARY KEY (source_id, external_edition_id),
  UNIQUE (source_id, directory_id)
);
CREATE INDEX provider_crosswalk_directory_idx ON comichuddle.directory_provider_crosswalk(directory_id);
CREATE TABLE comichuddle.directory_character_debuts (
  directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  character_name text NOT NULL CHECK (length(btrim(character_name)) BETWEEN 1 AND 180),
  debut_type text NOT NULL CHECK (debut_type IN ('FIRST_FULL','CAMEO','TEAM','COSTUME','CLAIMED')),
  verification_status text NOT NULL CHECK (verification_status IN ('VERIFIED','CLAIMED')),
  source_id uuid REFERENCES comichuddle.valuation_sources(id),
  evidence_uri text,
  note text NOT NULL DEFAULT '',
  PRIMARY KEY (directory_id, character_name, debut_type),
  CHECK (verification_status <> 'VERIFIED' OR
    (source_id IS NOT NULL AND evidence_uri IS NOT NULL AND length(btrim(evidence_uri)) > 0))
);
CREATE INDEX character_debut_source_idx ON comichuddle.directory_character_debuts(source_id);

CREATE TABLE comichuddle.review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  directory_id uuid NOT NULL UNIQUE REFERENCES comichuddle.directory_comics(id),
  submitted_by_user_id uuid NOT NULL REFERENCES comichuddle.users(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','MERGED','REJECTED')),
  submission_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(submission_evidence) = 'object'),
  target_directory_id uuid REFERENCES comichuddle.directory_comics(id),
  resolved_by_user_id uuid REFERENCES comichuddle.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'PENDING' AND resolved_by_user_id IS NULL AND resolved_at IS NULL AND target_directory_id IS NULL)
    OR (status <> 'PENDING' AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK ((status = 'MERGED' AND target_directory_id IS NOT NULL) OR (status <> 'MERGED' AND target_directory_id IS NULL))
);
CREATE INDEX review_pending_idx ON comichuddle.review_queue(created_at, id) WHERE status = 'PENDING';
CREATE INDEX review_submitter_idx ON comichuddle.review_queue(submitted_by_user_id);
CREATE INDEX review_resolver_idx ON comichuddle.review_queue(resolved_by_user_id);
CREATE INDEX review_target_idx ON comichuddle.review_queue(target_directory_id);

CREATE TABLE comichuddle.user_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES comichuddle.users(id),
  directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  physical_format text NOT NULL CHECK (physical_format IN ('RAW','GRADED')),
  raw_condition text CHECK (raw_condition IN ('POOR','FAIR','GOOD','VERY_GOOD','FINE','VERY_FINE','NEAR_MINT','MINT','UNKNOWN')),
  grade numeric CHECK (grade IS NULL OR (grade BETWEEN 0.5 AND 10 AND scale(grade) <= 1)),
  grading_company text CHECK (grading_company IN ('CGC','CBCS','PGX','OTHER')),
  label_type text CHECK (label_type IN ('UNIVERSAL','SIGNATURE','QUALIFIED','RESTORED','CONSERVED','OTHER','UNKNOWN')),
  certification_number text CHECK (certification_number IS NULL OR length(btrim(certification_number)) BETWEEN 1 AND 100),
  metadata_verification text NOT NULL DEFAULT 'DECLARED' CHECK (metadata_verification IN ('DECLARED','VERIFIED')),
  comparable_attributes_key text NOT NULL DEFAULT 'UNKNOWN' CHECK (length(btrim(comparable_attributes_key)) BETWEEN 1 AND 240),
  purchase_price_cents bigint CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
  purchase_currency text CHECK (purchase_currency IS NULL OR purchase_currency ~ '^[A-Z]{3}$'),
  private_notes text NOT NULL DEFAULT '' CHECK (length(private_notes) <= 500),
  purchased_at date,
  disposition text NOT NULL DEFAULT 'HELD' CHECK (disposition IN ('HELD','SOLD','REMOVED')),
  external_inventory_source text,
  external_copy_id text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (id, user_id, directory_id),
  UNIQUE (user_id, external_inventory_source, external_copy_id),
  CHECK ((external_inventory_source IS NULL AND external_copy_id IS NULL) OR
    (external_inventory_source IS NOT NULL AND external_copy_id IS NOT NULL AND
      length(btrim(external_inventory_source)) > 0 AND length(btrim(external_copy_id)) > 0)),
  CHECK ((purchase_price_cents IS NULL AND purchase_currency IS NULL) OR
    (purchase_price_cents IS NOT NULL AND purchase_currency IS NOT NULL)),
  CHECK ((physical_format = 'RAW' AND raw_condition IS NOT NULL AND grade IS NULL
    AND grading_company IS NULL AND label_type IS NULL AND certification_number IS NULL)
    OR (physical_format = 'GRADED' AND raw_condition IS NULL AND grade IS NOT NULL
      AND grading_company IS NOT NULL AND label_type IS NOT NULL)),
  CHECK (label_type IS NULL OR label_type NOT IN ('SIGNATURE','QUALIFIED','RESTORED','CONSERVED','OTHER')
    OR comparable_attributes_key NOT IN ('STANDARD','CGC_WHITE_NO_PREMIUM'))
);
CREATE INDEX collection_user_directory_idx ON comichuddle.user_collections(user_id, directory_id);
CREATE INDEX collection_directory_idx ON comichuddle.user_collections(directory_id);
-- Two physical copies of one edition are valid. A held certificate cannot be entered twice by its owner.
CREATE UNIQUE INDEX collection_held_certificate_idx ON comichuddle.user_collections
  (user_id, grading_company, certification_number)
  WHERE disposition = 'HELD' AND certification_number IS NOT NULL;

CREATE TABLE comichuddle.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES comichuddle.users(id),
  directory_comic_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  is_custom_entry boolean NOT NULL,
  listing_type text NOT NULL CHECK (listing_type IN ('SINGLE','LOT')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','UNDER_REVIEW','ACTIVE','RESERVED','SOLD','WITHDRAWN')),
  asking_price_cents bigint NOT NULL CHECK (asking_price_cents > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, seller_id),
  CHECK (NOT (status IN ('ACTIVE','RESERVED') AND is_custom_entry))
);
CREATE INDEX listing_seller_idx ON comichuddle.marketplace_listings(seller_id);
CREATE INDEX listing_directory_idx ON comichuddle.marketplace_listings(directory_comic_id);
CREATE INDEX listing_active_directory_idx ON comichuddle.marketplace_listings(directory_comic_id, currency, asking_price_cents, id)
  WHERE status = 'ACTIVE';

CREATE TABLE comichuddle.listing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  copy_id uuid NOT NULL,
  directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  reservation_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (listing_id, seller_id) REFERENCES comichuddle.marketplace_listings(id, seller_id),
  FOREIGN KEY (copy_id, seller_id) REFERENCES comichuddle.user_collections(id, user_id),
  UNIQUE (listing_id, copy_id),
  UNIQUE (id, listing_id, copy_id, seller_id, directory_id)
);
CREATE INDEX listing_item_directory_idx ON comichuddle.listing_items(directory_id);
CREATE INDEX listing_item_copy_owner_idx ON comichuddle.listing_items(copy_id, seller_id);
-- Reservation applies to each physical copy, not to the edition or just the lot header.
CREATE UNIQUE INDEX one_active_listing_per_physical_copy ON comichuddle.listing_items(copy_id) WHERE reservation_active;

CREATE TABLE comichuddle.fmv_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  source_id uuid NOT NULL REFERENCES comichuddle.valuation_sources(id),
  quote_kind text NOT NULL CHECK (quote_kind IN ('SALE_BASELINE','EDITORIAL_ESTIMATE','UNVERIFIED_CLAIM')),
  physical_format text NOT NULL CHECK (physical_format IN ('RAW','GRADED')),
  raw_condition text CHECK (raw_condition IN ('POOR','FAIR','GOOD','VERY_GOOD','FINE','VERY_FINE','NEAR_MINT','MINT')),
  grade numeric CHECK (grade IS NULL OR (grade BETWEEN 0.5 AND 10 AND scale(grade) <= 1)),
  grading_company text CHECK (grading_company IN ('CGC','CBCS','PGX','OTHER')),
  label_type text CHECK (label_type IN ('UNIVERSAL','SIGNATURE','QUALIFIED','RESTORED','CONSERVED','OTHER')),
  comparable_attributes_key text NOT NULL CHECK (length(btrim(comparable_attributes_key)) BETWEEN 1 AND 240),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  value_cents bigint NOT NULL CHECK (value_cents > 0),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  sample_count integer NOT NULL CHECK (sample_count >= 0),
  sale_window_start timestamptz,
  sale_window_end timestamptz,
  evidence_uri text NOT NULL CHECK (length(btrim(evidence_uri)) BETWEEN 1 AND 2000),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  methodology text NOT NULL CHECK (length(btrim(methodology)) BETWEEN 1 AND 4000),
  license_reference_snapshot text NOT NULL,
  license_status_snapshot text NOT NULL CHECK (license_status_snapshot IN ('CURRENT','EXPIRED','ABSENT')),
  commercial_display_snapshot boolean NOT NULL,
  verification_snapshot text NOT NULL CHECK (verification_snapshot IN ('VERIFIED','UNVERIFIED')),
  license_valid_until_snapshot timestamptz,
  max_age_hours_snapshot integer NOT NULL CHECK (max_age_hours_snapshot BETWEEN 1 AND 8760),
  minimum_sample_count_snapshot integer NOT NULL CHECK (minimum_sample_count_snapshot > 0),
  recorded_by_user_id uuid NOT NULL REFERENCES comichuddle.users(id),
  CHECK ((physical_format = 'RAW' AND raw_condition IS NOT NULL AND grade IS NULL AND grading_company IS NULL AND label_type IS NULL)
    OR (physical_format = 'GRADED' AND raw_condition IS NULL AND grade IS NOT NULL AND grading_company IS NOT NULL AND label_type IS NOT NULL)),
  CHECK ((sale_window_start IS NULL AND sale_window_end IS NULL)
    OR (sale_window_start IS NOT NULL AND sale_window_end IS NOT NULL AND sale_window_start <= sale_window_end AND sale_window_end <= observed_at)),
  UNIQUE NULLS NOT DISTINCT
    (directory_id, source_id, quote_kind, physical_format, raw_condition, grade, grading_company, label_type, comparable_attributes_key, currency, observed_at, evidence_sha256),
  CHECK (quote_kind <> 'SALE_BASELINE' OR comparable_attributes_key <> 'UNKNOWN'),
  CHECK (label_type IS NULL OR label_type NOT IN ('SIGNATURE','QUALIFIED','RESTORED','CONSERVED','OTHER')
    OR comparable_attributes_key NOT IN ('STANDARD','CGC_WHITE_NO_PREMIUM'))
);
CREATE INDEX fmv_exact_history_idx ON comichuddle.fmv_history
  (directory_id, physical_format, grading_company, grade, label_type, raw_condition, comparable_attributes_key, currency, observed_at DESC);
CREATE INDEX fmv_source_idx ON comichuddle.fmv_history(source_id);
CREATE INDEX fmv_recorder_idx ON comichuddle.fmv_history(recorded_by_user_id);

CREATE TABLE comichuddle.marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES comichuddle.marketplace_listings(id),
  seller_id uuid NOT NULL,
  buyer_id uuid NOT NULL REFERENCES comichuddle.users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (status IN ('PENDING','PAID','CANCELLED','FULFILLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (listing_id, seller_id) REFERENCES comichuddle.marketplace_listings(id, seller_id),
  UNIQUE (id, listing_id, seller_id, currency),
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX order_listing_seller_idx ON comichuddle.marketplace_orders(listing_id, seller_id);
CREATE INDEX order_buyer_idx ON comichuddle.marketplace_orders(buyer_id);
CREATE UNIQUE INDEX one_live_order_per_listing ON comichuddle.marketplace_orders(listing_id)
  WHERE status IN ('PENDING','PAID','FULFILLED');
CREATE TABLE comichuddle.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  listing_item_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  copy_id uuid NOT NULL,
  directory_id uuid NOT NULL,
  currency text NOT NULL,
  allocated_price_cents bigint NOT NULL CHECK (allocated_price_cents >= 0),
  edition_snapshot jsonb NOT NULL CHECK (jsonb_typeof(edition_snapshot) = 'object'),
  copy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(copy_snapshot) = 'object'),
  valuation_snapshot jsonb NOT NULL CHECK (jsonb_typeof(valuation_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, listing_id, seller_id, currency)
    REFERENCES comichuddle.marketplace_orders(id, listing_id, seller_id, currency),
  FOREIGN KEY (listing_item_id, listing_id, copy_id, seller_id, directory_id)
    REFERENCES comichuddle.listing_items(id, listing_id, copy_id, seller_id, directory_id),
  UNIQUE (order_id, listing_item_id)
);
CREATE INDEX order_item_listing_identity_idx ON comichuddle.order_items(listing_item_id, listing_id, copy_id, seller_id, directory_id);
CREATE TABLE comichuddle.marketplace_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES comichuddle.marketplace_listings(id),
  bidder_id uuid NOT NULL REFERENCES comichuddle.users(id),
  directory_id_snapshot uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  baseline_cents_snapshot bigint CHECK (baseline_cents_snapshot IS NULL OR baseline_cents_snapshot > 0),
  valuation_snapshot jsonb NOT NULL CHECK (jsonb_typeof(valuation_snapshot) = 'object'),
  status text NOT NULL CHECK (status IN ('OPEN','ACCEPTED','WITHDRAWN','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bid_listing_idx ON comichuddle.marketplace_bids(listing_id);
CREATE INDEX bid_bidder_idx ON comichuddle.marketplace_bids(bidder_id);
CREATE INDEX bid_directory_snapshot_idx ON comichuddle.marketplace_bids(directory_id_snapshot);

CREATE TABLE comichuddle.moderation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  review_id uuid NOT NULL REFERENCES comichuddle.review_queue(id),
  actor_user_id uuid NOT NULL REFERENCES comichuddle.users(id),
  source_directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  target_directory_id uuid NOT NULL REFERENCES comichuddle.directory_comics(id),
  expected_source_version bigint NOT NULL,
  expected_target_version bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('MERGED','APPROVED')),
  source_version bigint NOT NULL,
  target_version bigint NOT NULL,
  moved_copies integer NOT NULL CHECK (moved_copies >= 0),
  moved_listing_items integer NOT NULL CHECK (moved_listing_items >= 0),
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_review_idx ON comichuddle.moderation_audit(review_id);
CREATE INDEX moderation_actor_idx ON comichuddle.moderation_audit(actor_user_id);
CREATE INDEX moderation_source_idx ON comichuddle.moderation_audit(source_directory_id);
CREATE INDEX moderation_target_idx ON comichuddle.moderation_audit(target_directory_id);

CREATE FUNCTION comichuddle.actor_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Stable old IDs resolve without exposing another submitter's unreviewed free-text metadata.
CREATE FUNCTION comichuddle.resolve_directory_id(p_directory_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,comichuddle,pg_temp AS $$
  SELECT CASE WHEN d.status='CANONICAL' THEN d.id WHEN d.status='ALIASED' THEN d.redirect_directory_id
    WHEN d.created_by_user_id=comichuddle.actor_user_id() THEN d.id ELSE NULL END
  FROM comichuddle.directory_comics d WHERE d.id=p_directory_id
$$;
REVOKE ALL ON FUNCTION comichuddle.resolve_directory_id(uuid) FROM PUBLIC;

CREATE FUNCTION comichuddle.stamp_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  IF NEW.id <> OLD.id THEN RAISE EXCEPTION 'stable UUID cannot be changed' USING ERRCODE = '23514'; END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER directory_version BEFORE UPDATE ON comichuddle.directory_comics FOR EACH ROW EXECUTE FUNCTION comichuddle.stamp_version();
CREATE TRIGGER collection_version BEFORE UPDATE ON comichuddle.user_collections FOR EACH ROW EXECUTE FUNCTION comichuddle.stamp_version();
CREATE TRIGGER listing_version BEFORE UPDATE ON comichuddle.marketplace_listings FOR EACH ROW EXECUTE FUNCTION comichuddle.stamp_version();

CREATE FUNCTION comichuddle.guard_directory_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'CANONICAL' AND
    (NEW.status <> 'CANONICAL' OR
      ROW(NEW.publisher,NEW.title,NEW.series_start_year,NEW.issue_number,NEW.variant_code,NEW.printing,NEW.language_code,NEW.canonical_edition_key)
      IS DISTINCT FROM ROW(OLD.publisher,OLD.title,OLD.series_start_year,OLD.issue_number,OLD.variant_code,OLD.printing,OLD.language_code,OLD.canonical_edition_key)) THEN
    RAISE EXCEPTION 'canonical edition identity is immutable; create another edition' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ALIASED' AND NOT EXISTS
    (SELECT 1 FROM comichuddle.directory_comics WHERE id = NEW.redirect_directory_id AND status = 'CANONICAL') THEN
    RAISE EXCEPTION 'alias must redirect directly to a canonical edition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER directory_identity BEFORE INSERT OR UPDATE ON comichuddle.directory_comics
  FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_directory_identity();

CREATE FUNCTION comichuddle.enforce_review_contract() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
DECLARE d comichuddle.directory_comics; r comichuddle.review_queue; affected uuid;
BEGIN
  IF TG_TABLE_NAME = 'directory_comics' THEN affected := coalesce(NEW.id, OLD.id);
  ELSE affected := coalesce(NEW.directory_id, OLD.directory_id); END IF;
  SELECT * INTO d FROM comichuddle.directory_comics WHERE id = affected;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM comichuddle.review_queue WHERE directory_id = affected;
  IF d.status IN ('PROVISIONAL','ALIASED') AND r.id IS NULL THEN
    RAISE EXCEPTION 'custom edition requires a review queue row in the same transaction' USING ERRCODE = '23514';
  END IF;
  IF r.id IS NOT NULL AND r.submitted_by_user_id <> d.created_by_user_id THEN
    RAISE EXCEPTION 'review submitter differs from directory creator' USING ERRCODE = '23514';
  END IF;
  IF d.status = 'PROVISIONAL' AND r.status NOT IN ('PENDING','REJECTED') THEN
    RAISE EXCEPTION 'provisional edition cannot have a resolved approval' USING ERRCODE = '23514';
  END IF;
  IF d.status = 'ALIASED' AND (r.status <> 'MERGED' OR r.target_directory_id IS DISTINCT FROM d.redirect_directory_id) THEN
    RAISE EXCEPTION 'alias and merged review must agree' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER directory_review_contract AFTER INSERT OR UPDATE ON comichuddle.directory_comics
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_review_contract();
CREATE CONSTRAINT TRIGGER queue_directory_contract AFTER INSERT OR UPDATE OR DELETE ON comichuddle.review_queue
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_review_contract();

CREATE FUNCTION comichuddle.guard_copy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'collection owner is immutable; resale creates a new ownership record' USING ERRCODE = '23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.disposition='SOLD' AND NEW.disposition<>'SOLD' THEN
    RAISE EXCEPTION 'sold ownership cannot be revived; create a new ownership record' USING ERRCODE='23514';
  END IF;
  -- Serialize identity assignment with an edition merge; recheck the row after any lock wait.
  PERFORM 1 FROM comichuddle.directory_comics WHERE id = NEW.directory_id AND status <> 'ALIASED' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'new/current copies must use the resolved directory UUID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_contract BEFORE INSERT OR UPDATE ON comichuddle.user_collections FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_copy();

CREATE FUNCTION comichuddle.guard_listing_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
DECLARE listing_status text;
BEGIN
  SELECT status INTO listing_status FROM comichuddle.marketplace_listings
    WHERE id = coalesce(NEW.listing_id, OLD.listing_id) FOR UPDATE;
  IF listing_status = 'SOLD' AND NOT (TG_OP='UPDATE' AND OLD.reservation_active AND NOT NEW.reservation_active
    AND (to_jsonb(NEW)-'reservation_active') IS NOT DISTINCT FROM (to_jsonb(OLD)-'reservation_active')) THEN
    RAISE EXCEPTION 'sold listing items are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW.listing_id,NEW.seller_id,NEW.copy_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.listing_id,OLD.seller_id,OLD.copy_id) THEN
    RAISE EXCEPTION 'listing physical-copy identity is immutable' USING ERRCODE = '23514';
  END IF;
  NEW.reservation_active := listing_status IN ('ACTIVE','RESERVED');
  RETURN NEW;
END $$;
CREATE TRIGGER listing_item_reservation BEFORE INSERT OR UPDATE OR DELETE ON comichuddle.listing_items
  FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_listing_item();

CREATE FUNCTION comichuddle.sync_listing_reservations() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  -- Updating to SOLD must release reservations while preserving the sold line identity.
  IF NEW.status = 'SOLD' THEN
    UPDATE comichuddle.listing_items SET reservation_active = false WHERE listing_id = NEW.id AND reservation_active;
    UPDATE comichuddle.user_collections c SET disposition='SOLD'
      WHERE c.disposition='HELD' AND EXISTS(SELECT 1 FROM comichuddle.listing_items i WHERE i.listing_id=NEW.id AND i.copy_id=c.id);
  ELSE
    UPDATE comichuddle.listing_items SET reservation_active = NEW.status IN ('ACTIVE','RESERVED')
      WHERE listing_id = NEW.id AND reservation_active IS DISTINCT FROM (NEW.status IN ('ACTIVE','RESERVED'));
  END IF;
  RETURN NULL;
END $$;
-- SOLD release is handled by the item guard's narrow exception below.
CREATE TRIGGER listing_reservations AFTER UPDATE OF status ON comichuddle.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION comichuddle.sync_listing_reservations();

CREATE FUNCTION comichuddle.guard_listing_header() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  IF NEW.seller_id <> OLD.seller_id THEN RAISE EXCEPTION 'listing seller is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='SOLD' THEN RAISE EXCEPTION 'sold listing header is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='SOLD' AND OLD.status NOT IN ('ACTIVE','RESERVED') THEN
    RAISE EXCEPTION 'only an active/reserved listing can be sold' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_header_contract BEFORE UPDATE ON comichuddle.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_listing_header();

CREATE FUNCTION comichuddle.enforce_listing_contract() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
DECLARE ids uuid[]; listing_id_to_check uuid; l comichuddle.marketplace_listings;
  item_count integer; custom_count integer; anchor_count integer;
BEGIN
  IF TG_TABLE_NAME = 'marketplace_listings' THEN ids := ARRAY[coalesce(NEW.id,OLD.id)];
  ELSIF TG_TABLE_NAME = 'listing_items' THEN ids := ARRAY[coalesce(NEW.listing_id,OLD.listing_id)];
  ELSIF TG_TABLE_NAME = 'user_collections' THEN
    SELECT array_agg(DISTINCT listing_id) INTO ids FROM comichuddle.listing_items WHERE copy_id = coalesce(NEW.id,OLD.id);
  ELSE
    SELECT array_agg(DISTINCT listing_id) INTO ids FROM comichuddle.listing_items WHERE directory_id = coalesce(NEW.id,OLD.id);
  END IF;
  FOREACH listing_id_to_check IN ARRAY coalesce(ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO l FROM comichuddle.marketplace_listings WHERE id = listing_id_to_check FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT count(*), count(*) FILTER (WHERE d.status <> 'CANONICAL'),
      count(*) FILTER (WHERE i.directory_id = l.directory_comic_id)
      INTO item_count, custom_count, anchor_count
      FROM comichuddle.listing_items i JOIN comichuddle.directory_comics d ON d.id = i.directory_id WHERE i.listing_id = l.id;
    IF item_count = 0 AND l.status NOT IN ('DRAFT','WITHDRAWN') THEN
      RAISE EXCEPTION 'published/review/reserved/sold listing requires physical-copy lines' USING ERRCODE = '23514';
    END IF;
    IF item_count > 0 AND anchor_count = 0 THEN
      RAISE EXCEPTION 'lot anchor must be one of its exact item editions' USING ERRCODE = '23514';
    END IF;
    IF l.listing_type = 'SINGLE' AND item_count > 1 THEN
      RAISE EXCEPTION 'single listing has more than one physical copy' USING ERRCODE = '23514';
    END IF;
    IF l.status <> 'SOLD' THEN
      IF item_count > 0 AND l.is_custom_entry IS DISTINCT FROM (custom_count > 0) THEN
        RAISE EXCEPTION 'is_custom_entry must aggregate every lot line' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM comichuddle.listing_items i JOIN comichuddle.user_collections c ON c.id = i.copy_id
        WHERE i.listing_id = l.id AND (i.directory_id <> c.directory_id OR i.seller_id <> c.user_id)) THEN
        RAISE EXCEPTION 'listing edition or owner differs from its physical copy' USING ERRCODE = '23514';
      END IF;
      IF l.status IN ('ACTIVE','RESERVED') AND
        (custom_count > 0 OR EXISTS (SELECT 1 FROM comichuddle.listing_items i JOIN comichuddle.user_collections c ON c.id=i.copy_id
          WHERE i.listing_id=l.id AND c.disposition <> 'HELD')) THEN
        RAISE EXCEPTION 'checkout requires canonical editions and held copies' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM comichuddle.listing_items WHERE listing_id=l.id
      AND reservation_active IS DISTINCT FROM (l.status IN ('ACTIVE','RESERVED'))) THEN
      RAISE EXCEPTION 'copy reservations differ from listing status' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER listing_contract AFTER INSERT OR UPDATE ON comichuddle.marketplace_listings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_listing_contract();
CREATE CONSTRAINT TRIGGER listing_line_contract AFTER INSERT OR UPDATE OR DELETE ON comichuddle.listing_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_listing_contract();
CREATE CONSTRAINT TRIGGER collection_listing_contract AFTER UPDATE ON comichuddle.user_collections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_listing_contract();
CREATE CONSTRAINT TRIGGER directory_listing_contract AFTER UPDATE ON comichuddle.directory_comics
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_listing_contract();

CREATE FUNCTION comichuddle.snapshot_quote_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, comichuddle, pg_temp AS $$
DECLARE s comichuddle.valuation_sources; directory_status text;
BEGIN
  SELECT * INTO STRICT s FROM comichuddle.valuation_sources WHERE id=NEW.source_id FOR SHARE;
  SELECT status INTO STRICT directory_status FROM comichuddle.directory_comics WHERE id=NEW.directory_id FOR SHARE;
  IF NEW.quote_kind = 'SALE_BASELINE' AND
    (directory_status <> 'CANONICAL' OR s.source_kind NOT IN ('LICENSED_SALES','VERIFIED_SALES') OR
      s.verification_status <> 'VERIFIED' OR s.license_status <> 'CURRENT' OR NOT s.commercial_display_permitted OR
      s.license_valid_until IS NULL OR s.license_valid_until <= NEW.observed_at OR NEW.sample_count < s.minimum_sample_count) THEN
    RAISE EXCEPTION 'baseline requires canonical identity, reviewed sales evidence, display rights and sufficient samples' USING ERRCODE='23514';
  END IF;
  IF (NEW.quote_kind = 'EDITORIAL_ESTIMATE' AND s.source_kind <> 'EDITORIAL') OR
      (NEW.quote_kind = 'UNVERIFIED_CLAIM' AND s.source_kind <> 'UNVERIFIED') THEN
    RAISE EXCEPTION 'quote kind differs from supplier provenance' USING ERRCODE='23514';
  END IF;
  NEW.license_reference_snapshot := s.license_reference;
  NEW.license_status_snapshot := s.license_status;
  NEW.commercial_display_snapshot := s.commercial_display_permitted;
  NEW.verification_snapshot := s.verification_status;
  NEW.license_valid_until_snapshot := s.license_valid_until;
  NEW.max_age_hours_snapshot := s.max_age_hours;
  NEW.minimum_sample_count_snapshot := s.minimum_sample_count;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_provenance BEFORE INSERT ON comichuddle.fmv_history
  FOR EACH ROW EXECUTE FUNCTION comichuddle.snapshot_quote_provenance();

CREATE FUNCTION comichuddle.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION '% is append-only; add a correction record instead', TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_fmv_history BEFORE UPDATE OR DELETE ON comichuddle.fmv_history
  FOR EACH ROW EXECUTE FUNCTION comichuddle.reject_mutation();
CREATE TRIGGER immutable_moderation_audit BEFORE UPDATE OR DELETE ON comichuddle.moderation_audit
  FOR EACH ROW EXECUTE FUNCTION comichuddle.reject_mutation();
CREATE TRIGGER immutable_order_items BEFORE UPDATE OR DELETE ON comichuddle.order_items
  FOR EACH ROW EXECUTE FUNCTION comichuddle.reject_mutation();

CREATE FUNCTION comichuddle.guard_financial_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'financial snapshots cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'financial identity, price and evidence snapshots are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_order_finance BEFORE UPDATE OR DELETE ON comichuddle.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_financial_snapshot();
CREATE TRIGGER immutable_bid_finance BEFORE UPDATE OR DELETE ON comichuddle.marketplace_bids
  FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_financial_snapshot();

CREATE FUNCTION comichuddle.guard_new_bid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,comichuddle,pg_temp AS $$
DECLARE l comichuddle.marketplace_listings;
BEGIN
  SELECT * INTO STRICT l FROM comichuddle.marketplace_listings WHERE id=NEW.listing_id FOR SHARE;
  IF NEW.currency<>l.currency OR NEW.directory_id_snapshot<>l.directory_comic_id OR NEW.bidder_id=l.seller_id
    OR l.status<>'ACTIVE' OR l.is_custom_entry OR NEW.status<>'OPEN' THEN
    RAISE EXCEPTION 'new bids require another seller, active canonical listing and exact currency/edition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER new_bid_contract BEFORE INSERT ON comichuddle.marketplace_bids
  FOR EACH ROW EXECUTE FUNCTION comichuddle.guard_new_bid();

CREATE FUNCTION comichuddle.snapshot_order_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
BEGIN
  SELECT jsonb_build_object('directoryId',d.id,'title',d.title,'issueNumber',d.issue_number,'publisher',d.publisher,
      'seriesStartYear',d.series_start_year,'variantCode',d.variant_code,'printing',d.printing,'language',d.language_code),
    jsonb_build_object('copyId',c.id,'format',c.physical_format,'rawCondition',c.raw_condition,'grade',c.grade,
      'gradingCompany',c.grading_company,'labelType',c.label_type,'certificationNumber',c.certification_number,
      'comparableAttributesKey',c.comparable_attributes_key)
    INTO STRICT NEW.edition_snapshot, NEW.copy_snapshot
    FROM comichuddle.directory_comics d JOIN comichuddle.user_collections c ON c.id=NEW.copy_id
    WHERE d.id=NEW.directory_id AND c.user_id=NEW.seller_id;
  RETURN NEW;
END $$;
CREATE TRIGGER order_item_snapshot BEFORE INSERT ON comichuddle.order_items
  FOR EACH ROW EXECUTE FUNCTION comichuddle.snapshot_order_item();

CREATE FUNCTION comichuddle.enforce_order_contract() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, comichuddle, pg_temp AS $$
DECLARE order_to_check uuid; o comichuddle.marketplace_orders; l comichuddle.marketplace_listings;
BEGIN
  IF TG_TABLE_NAME='marketplace_orders' THEN order_to_check:=coalesce(NEW.id,OLD.id);
  ELSE order_to_check:=coalesce(NEW.order_id,OLD.order_id); END IF;
  SELECT * INTO o FROM comichuddle.marketplace_orders WHERE id=order_to_check;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT l FROM comichuddle.marketplace_listings WHERE id=o.listing_id;
  IF l.is_custom_entry OR l.status NOT IN ('ACTIVE','RESERVED','SOLD') OR o.currency <> l.currency THEN
    RAISE EXCEPTION 'orders cannot purchase quarantined or incomparable listings' USING ERRCODE='23514';
  END IF;
  IF (SELECT coalesce(sum(allocated_price_cents),0) FROM comichuddle.order_items WHERE order_id=o.id) <> o.amount_cents THEN
    RAISE EXCEPTION 'order line allocations must equal the immutable order total' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM comichuddle.order_items WHERE order_id=o.id) <>
    (SELECT count(*) FROM comichuddle.listing_items WHERE listing_id=o.listing_id) THEN
    RAISE EXCEPTION 'order snapshot must cover every physical-copy line' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_contract AFTER INSERT OR UPDATE ON comichuddle.marketplace_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_order_contract();
CREATE CONSTRAINT TRIGGER order_item_contract AFTER INSERT ON comichuddle.order_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION comichuddle.enforce_order_contract();

CREATE FUNCTION comichuddle.evaluate_fmv_quote(p_quote_id uuid, p_as_of timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, comichuddle, pg_temp AS $$
SELECT CASE
  WHEN d.status <> 'CANONICAL' THEN 'CUSTOM_PENDING_REVIEW'
  WHEN h.quote_kind = 'EDITORIAL_ESTIMATE' THEN 'EDITORIAL_ONLY'
  WHEN h.quote_kind <> 'SALE_BASELINE' OR s.source_kind NOT IN ('LICENSED_SALES','VERIFIED_SALES') THEN 'UNVERIFIED_SOURCE'
  WHEN h.verification_snapshot <> 'VERIFIED' OR s.verification_status <> 'VERIFIED' THEN 'UNVERIFIED_SOURCE'
  WHEN NOT h.commercial_display_snapshot OR NOT s.commercial_display_permitted OR
    h.license_status_snapshot <> 'CURRENT' OR s.license_status <> 'CURRENT' OR
    h.license_valid_until_snapshot IS NULL OR s.license_valid_until IS NULL OR
    h.license_valid_until_snapshot <= p_as_of OR s.license_valid_until <= p_as_of THEN 'LICENSE_UNAVAILABLE'
  WHEN h.sample_count < greatest(h.minimum_sample_count_snapshot,s.minimum_sample_count) THEN 'INSUFFICIENT_SAMPLE'
  WHEN h.observed_at > p_as_of OR h.observed_at + make_interval(hours=>least(h.max_age_hours_snapshot,s.max_age_hours)) <= p_as_of THEN 'STALE'
  ELSE 'PRICED' END
FROM comichuddle.fmv_history h JOIN comichuddle.valuation_sources s ON s.id=h.source_id
 JOIN comichuddle.directory_comics d ON d.id=h.directory_id WHERE h.id=p_quote_id
$$;

CREATE VIEW comichuddle.fmv_quote_candidates AS
SELECT h.*, s.name AS source_name,s.public_attribution,s.public_methodology,
  least(h.observed_at + make_interval(hours=>least(h.max_age_hours_snapshot,s.max_age_hours)),
    h.license_valid_until_snapshot,s.license_valid_until) AS expires_at,
  comichuddle.evaluate_fmv_quote(h.id,now()) AS current_state,
  (h.commercial_display_snapshot AND s.commercial_display_permitted AND
    h.license_status_snapshot='CURRENT' AND s.license_status='CURRENT' AND
    h.license_valid_until_snapshot > now() AND s.license_valid_until > now()) AS display_rights_current
FROM comichuddle.fmv_history h JOIN comichuddle.valuation_sources s ON s.id=h.source_id;
CREATE VIEW comichuddle.fmv_current_baselines AS
SELECT DISTINCT ON (directory_id, physical_format, raw_condition, grade, grading_company, label_type, comparable_attributes_key, currency) *
FROM comichuddle.fmv_quote_candidates WHERE current_state='PRICED'
ORDER BY directory_id, physical_format, raw_condition, grade, grading_company, label_type, comparable_attributes_key, currency, observed_at DESC, recorded_at DESC, id;

-- Requested convenience FMV fields are an enforceable live projection, never editable scalars.
-- RAW means NEAR_MINT/STANDARD/USD; CGC means UNIVERSAL/white-pages/no-premium/USD.
CREATE VIEW comichuddle.directory_comics_fmv AS
SELECT d.*,
  (SELECT value_cents FROM comichuddle.fmv_current_baselines q WHERE q.directory_id=d.id AND q.physical_format='RAW' AND q.raw_condition='NEAR_MINT' AND q.comparable_attributes_key='STANDARD' AND q.currency='USD') AS raw_fmv_cents,
  (SELECT value_cents FROM comichuddle.fmv_current_baselines q WHERE q.directory_id=d.id AND q.grading_company='CGC' AND q.grade=9.8 AND q.label_type='UNIVERSAL' AND q.comparable_attributes_key='CGC_WHITE_NO_PREMIUM' AND q.currency='USD') AS cgc_9_8_fmv_cents,
  (SELECT value_cents FROM comichuddle.fmv_current_baselines q WHERE q.directory_id=d.id AND q.grading_company='CGC' AND q.grade=9.6 AND q.label_type='UNIVERSAL' AND q.comparable_attributes_key='CGC_WHITE_NO_PREMIUM' AND q.currency='USD') AS cgc_9_6_fmv_cents,
  (SELECT value_cents FROM comichuddle.fmv_current_baselines q WHERE q.directory_id=d.id AND q.grading_company='CGC' AND q.grade=9.0 AND q.label_type='UNIVERSAL' AND q.comparable_attributes_key='CGC_WHITE_NO_PREMIUM' AND q.currency='USD') AS cgc_9_0_fmv_cents
FROM comichuddle.directory_comics d
WHERE d.status='CANONICAL' OR d.created_by_user_id=comichuddle.actor_user_id()
  OR current_setting('app.review_preview',true)='true';

-- Deliberately sanitized service read model. No purchase cost or certificate is exposed.
CREATE VIEW comichuddle.marketplace_item_facts WITH (security_barrier=true) AS
SELECT l.id AS listing_id,l.seller_id,l.directory_comic_id,l.is_custom_entry,l.listing_type,l.status AS listing_status,
  l.asking_price_cents,l.currency,i.id AS listing_item_id,i.copy_id,i.directory_id,
  d.title,d.issue_number,d.variant_name,d.status AS directory_status,
  c.physical_format,c.raw_condition,c.grade,c.grading_company,c.label_type,c.metadata_verification,c.comparable_attributes_key
FROM comichuddle.marketplace_listings l JOIN comichuddle.listing_items i ON i.listing_id=l.id
 JOIN comichuddle.directory_comics d ON d.id=i.directory_id JOIN comichuddle.user_collections c ON c.id=i.copy_id
WHERE l.status IN ('ACTIVE','RESERVED') OR l.seller_id=comichuddle.actor_user_id()
  OR (l.status='UNDER_REVIEW' AND current_setting('app.review_preview',true)='true'
    AND NOT EXISTS(SELECT 1 FROM comichuddle.listing_items rejected_item JOIN comichuddle.review_queue r ON r.directory_id=rejected_item.directory_id
      WHERE rejected_item.listing_id=l.id AND r.status='REJECTED'));

CREATE FUNCTION comichuddle.create_custom_directory_entry(
  p_title text,p_issue_number text,p_publisher text,p_variant_name text,
  p_variant_code text,p_series_start_year integer,p_submission_evidence jsonb,p_actor_user_id uuid
) RETURNS TABLE(directory_id uuid,review_id uuid,version bigint)
LANGUAGE plpgsql SET search_path=pg_catalog,comichuddle,pg_temp AS $$
DECLARE new_directory_id uuid; new_review_id uuid;
BEGIN
  IF comichuddle.actor_user_id() IS DISTINCT FROM p_actor_user_id OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'custom entry actor must come from authenticated server context' USING ERRCODE='42501';
  END IF;
  INSERT INTO comichuddle.directory_comics(title,issue_number,publisher,variant_name,variant_code,series_start_year,created_by_user_id)
    VALUES(p_title,p_issue_number,p_publisher,p_variant_name,p_variant_code,p_series_start_year,p_actor_user_id)
    RETURNING id INTO new_directory_id;
  INSERT INTO comichuddle.review_queue(directory_id,submitted_by_user_id,submission_evidence)
    VALUES(new_directory_id,p_actor_user_id,p_submission_evidence) RETURNING id INTO new_review_id;
  RETURN QUERY SELECT new_directory_id,new_review_id,1::bigint;
END $$;
REVOKE ALL ON FUNCTION comichuddle.create_custom_directory_entry(text,text,text,text,text,integer,jsonb,uuid) FROM PUBLIC;

CREATE FUNCTION comichuddle.merge_custom_edition(
  p_review_id uuid, p_target_directory_id uuid, p_expected_source_version bigint,
  p_expected_target_version bigint, p_request_id uuid, p_actor_user_id uuid
) RETURNS TABLE(outcome_id uuid,outcome text,source_directory_id uuid,target_directory_id uuid,
  source_version bigint,target_version bigint,moved_copies integer,moved_listing_items integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, comichuddle, pg_temp AS $$
DECLARE r comichuddle.review_queue; src comichuddle.directory_comics; dst comichuddle.directory_comics;
  prior comichuddle.moderation_audit; audit_id uuid; copy_count integer; item_count integer;
  affected_listing_ids uuid[];
  before_data jsonb; after_data jsonb;
BEGIN
  IF comichuddle.actor_user_id() IS DISTINCT FROM p_actor_user_id OR NOT EXISTS
    (SELECT 1 FROM comichuddle.admin_memberships WHERE user_id=p_actor_user_id AND active AND role IN ('MODERATOR','ADMIN')) THEN
    RAISE EXCEPTION 'moderation requires authenticated active admin role' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('comichuddle-merge-request:' || p_request_id::text,0));
  SELECT * INTO prior FROM comichuddle.moderation_audit WHERE request_id=p_request_id;
  IF FOUND THEN
    IF ROW(prior.review_id,prior.target_directory_id,prior.actor_user_id,prior.expected_source_version,prior.expected_target_version)
      IS DISTINCT FROM ROW(p_review_id,p_target_directory_id,p_actor_user_id,p_expected_source_version,p_expected_target_version) THEN
      RAISE EXCEPTION 'idempotency UUID reused for another request' USING ERRCODE='23514';
    END IF;
    RETURN QUERY SELECT prior.id,prior.outcome,prior.source_directory_id,prior.target_directory_id,
      prior.source_version,prior.target_version,prior.moved_copies,prior.moved_listing_items;
    RETURN;
  END IF;
  SELECT * INTO STRICT r FROM comichuddle.review_queue WHERE id=p_review_id FOR UPDATE;
  IF r.directory_id=p_target_directory_id THEN RAISE EXCEPTION 'cannot merge an edition into itself' USING ERRCODE='23514'; END IF;
  -- Sorted edition locks make merges of overlapping targets serialize without changing UUIDs.
  PERFORM id FROM comichuddle.directory_comics WHERE id IN (r.directory_id,p_target_directory_id) ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT src FROM comichuddle.directory_comics WHERE id=r.directory_id;
  SELECT * INTO STRICT dst FROM comichuddle.directory_comics WHERE id=p_target_directory_id;
  IF r.status <> 'PENDING' OR src.status <> 'PROVISIONAL' OR dst.status <> 'CANONICAL' THEN
    RAISE EXCEPTION 'merge requires pending provisional source and canonical target' USING ERRCODE='23514';
  END IF;
  IF src.version <> p_expected_source_version OR dst.version <> p_expected_target_version THEN
    RAISE EXCEPTION 'edition version changed; reload before resolving review' USING ERRCODE='40001';
  END IF;
  SELECT array_agg(l.id ORDER BY l.id) INTO affected_listing_ids FROM comichuddle.marketplace_listings l WHERE l.status <> 'SOLD' AND
    (l.directory_comic_id=src.id OR EXISTS(SELECT 1 FROM comichuddle.listing_items i WHERE i.listing_id=l.id AND i.directory_id=src.id));
  PERFORM l.id FROM comichuddle.marketplace_listings l WHERE l.id=ANY(coalesce(affected_listing_ids,ARRAY[]::uuid[])) ORDER BY l.id FOR UPDATE;
  PERFORM id FROM comichuddle.user_collections WHERE directory_id=src.id ORDER BY id FOR UPDATE;
  before_data:=jsonb_build_object('source',to_jsonb(src),'target',to_jsonb(dst),'review',to_jsonb(r));
  -- No UNIQUE(user,edition): distinct physical copies remain distinct, including two copies of the same issue.
  -- Owner/certificate/provider copy uniqueness is global already, so merging cannot silently collapse inventory.
  UPDATE comichuddle.user_collections SET directory_id=dst.id WHERE directory_id=src.id;
  GET DIAGNOSTICS copy_count = ROW_COUNT;
  UPDATE comichuddle.listing_items i SET directory_id=dst.id FROM comichuddle.marketplace_listings l
    WHERE i.listing_id=l.id AND l.status <> 'SOLD' AND i.directory_id=src.id;
  GET DIAGNOSTICS item_count = ROW_COUNT;
  UPDATE comichuddle.marketplace_listings SET directory_comic_id=dst.id WHERE directory_comic_id=src.id AND status <> 'SOLD';
  UPDATE comichuddle.marketplace_listings l SET
    is_custom_entry=EXISTS(SELECT 1 FROM comichuddle.listing_items i JOIN comichuddle.directory_comics d ON d.id=i.directory_id
      WHERE i.listing_id=l.id AND d.status <> 'CANONICAL'),
    status=CASE WHEN l.status='UNDER_REVIEW' AND NOT EXISTS
      (SELECT 1 FROM comichuddle.listing_items i JOIN comichuddle.directory_comics d ON d.id=i.directory_id
       WHERE i.listing_id=l.id AND d.status <> 'CANONICAL') THEN 'DRAFT' ELSE l.status END
    WHERE l.status <> 'SOLD' AND l.id=ANY(coalesce(affected_listing_ids,ARRAY[]::uuid[]));
  UPDATE comichuddle.review_queue SET status='MERGED',target_directory_id=dst.id,
    resolved_by_user_id=p_actor_user_id,resolved_at=now(),resolution_note='Identity merged; price is evaluated independently.' WHERE id=r.id;
  UPDATE comichuddle.directory_comics SET status='ALIASED',redirect_directory_id=dst.id WHERE id=src.id RETURNING * INTO src;
  after_data:=jsonb_build_object('source',to_jsonb(src),'target',to_jsonb(dst),'movedCopies',copy_count,'movedListingItems',item_count);
  INSERT INTO comichuddle.moderation_audit(request_id,review_id,actor_user_id,source_directory_id,target_directory_id,
    expected_source_version,expected_target_version,outcome,source_version,target_version,moved_copies,moved_listing_items,before_snapshot,after_snapshot)
    VALUES(p_request_id,r.id,p_actor_user_id,src.id,dst.id,p_expected_source_version,p_expected_target_version,'MERGED',
      src.version,dst.version,copy_count,item_count,before_data,after_data) RETURNING id INTO audit_id;
  RETURN QUERY SELECT audit_id,'MERGED'::text,src.id,dst.id,src.version,dst.version,copy_count,item_count;
END $$;
REVOKE ALL ON FUNCTION comichuddle.merge_custom_edition(uuid,uuid,bigint,bigint,uuid,uuid) FROM PUBLIC;

-- Approve an independently researched new identity without minting any valuation.
CREATE FUNCTION comichuddle.approve_custom_edition(
  p_review_id uuid,p_canonical_edition_key text,p_series_start_year integer,
  p_expected_version bigint,p_request_id uuid,p_actor_user_id uuid
) RETURNS TABLE(outcome_id uuid,outcome text,directory_id uuid,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,comichuddle,pg_temp AS $$
DECLARE r comichuddle.review_queue; d comichuddle.directory_comics; prior comichuddle.moderation_audit;
  audit_id uuid; before_data jsonb;
BEGIN
  IF comichuddle.actor_user_id() IS DISTINCT FROM p_actor_user_id OR NOT EXISTS
    (SELECT 1 FROM comichuddle.admin_memberships WHERE user_id=p_actor_user_id AND active AND role IN ('MODERATOR','ADMIN')) THEN
    RAISE EXCEPTION 'approval requires authenticated active admin role' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('comichuddle-merge-request:'||p_request_id::text,0));
  SELECT * INTO prior FROM comichuddle.moderation_audit WHERE request_id=p_request_id;
  IF FOUND THEN
    IF prior.outcome<>'APPROVED' OR prior.review_id<>p_review_id OR prior.actor_user_id<>p_actor_user_id
      OR prior.expected_source_version<>p_expected_version
      OR prior.after_snapshot->'directory'->>'canonical_edition_key' IS DISTINCT FROM p_canonical_edition_key
      OR (prior.after_snapshot->'directory'->>'series_start_year')::integer IS DISTINCT FROM p_series_start_year THEN
      RAISE EXCEPTION 'idempotency UUID reused for another request' USING ERRCODE='23514';
    END IF;
    RETURN QUERY SELECT prior.id,prior.outcome,prior.source_directory_id,prior.source_version; RETURN;
  END IF;
  SELECT * INTO STRICT r FROM comichuddle.review_queue WHERE id=p_review_id FOR UPDATE;
  SELECT * INTO STRICT d FROM comichuddle.directory_comics WHERE id=r.directory_id FOR UPDATE;
  IF r.status<>'PENDING' OR d.status<>'PROVISIONAL' THEN RAISE EXCEPTION 'approval requires pending provisional identity' USING ERRCODE='23514'; END IF;
  IF d.version<>p_expected_version THEN RAISE EXCEPTION 'edition version changed' USING ERRCODE='40001'; END IF;
  before_data:=jsonb_build_object('directory',to_jsonb(d),'review',to_jsonb(r));
  UPDATE comichuddle.directory_comics SET status='CANONICAL',canonical_edition_key=p_canonical_edition_key,series_start_year=p_series_start_year
    WHERE id=d.id RETURNING * INTO d;
  UPDATE comichuddle.review_queue SET status='APPROVED',resolved_by_user_id=p_actor_user_id,resolved_at=now(),
    resolution_note='Identity approved; no valuation was created.' WHERE id=r.id;
  UPDATE comichuddle.marketplace_listings l SET
    is_custom_entry=EXISTS(SELECT 1 FROM comichuddle.listing_items i JOIN comichuddle.directory_comics e ON e.id=i.directory_id
      WHERE i.listing_id=l.id AND e.status<>'CANONICAL'),
    status=CASE WHEN l.status='UNDER_REVIEW' AND NOT EXISTS
      (SELECT 1 FROM comichuddle.listing_items i JOIN comichuddle.directory_comics e ON e.id=i.directory_id WHERE i.listing_id=l.id AND e.status<>'CANONICAL')
      THEN 'DRAFT' ELSE l.status END
    WHERE l.status<>'SOLD' AND EXISTS(SELECT 1 FROM comichuddle.listing_items affected_item WHERE affected_item.listing_id=l.id AND affected_item.directory_id=d.id);
  INSERT INTO comichuddle.moderation_audit(request_id,review_id,actor_user_id,source_directory_id,target_directory_id,
    expected_source_version,expected_target_version,outcome,source_version,target_version,moved_copies,moved_listing_items,before_snapshot,after_snapshot)
    VALUES(p_request_id,r.id,p_actor_user_id,d.id,d.id,p_expected_version,p_expected_version,'APPROVED',d.version,d.version,0,0,
      before_data,jsonb_build_object('directory',to_jsonb(d),'valuationCreated',false)) RETURNING id INTO audit_id;
  RETURN QUERY SELECT audit_id,'APPROVED'::text,d.id,d.version;
END $$;
REVOKE ALL ON FUNCTION comichuddle.approve_custom_edition(uuid,text,integer,bigint,uuid,uuid) FROM PUBLIC;

-- RLS is applied to private/base tables. Service roles are defined separately in roles.sql.
ALTER TABLE comichuddle.directory_comics ENABLE ROW LEVEL SECURITY;
CREATE POLICY directory_read ON comichuddle.directory_comics FOR SELECT
  USING (status='CANONICAL' OR created_by_user_id=comichuddle.actor_user_id() OR current_setting('app.review_preview',true)='true');
CREATE POLICY directory_custom_insert ON comichuddle.directory_comics FOR INSERT
  WITH CHECK (status='PROVISIONAL' AND created_by_user_id=comichuddle.actor_user_id());
ALTER TABLE comichuddle.user_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_owner ON comichuddle.user_collections
  USING (user_id=comichuddle.actor_user_id()) WITH CHECK (user_id=comichuddle.actor_user_id());
ALTER TABLE comichuddle.marketplace_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_read ON comichuddle.marketplace_listings FOR SELECT
  USING (status IN ('ACTIVE','RESERVED') OR seller_id=comichuddle.actor_user_id()
    OR (status='UNDER_REVIEW' AND current_setting('app.review_preview',true)='true'));
CREATE POLICY listing_owner_insert ON comichuddle.marketplace_listings FOR INSERT WITH CHECK (seller_id=comichuddle.actor_user_id());
CREATE POLICY listing_owner_update ON comichuddle.marketplace_listings FOR UPDATE
  USING (seller_id=comichuddle.actor_user_id() AND status <> 'SOLD') WITH CHECK (seller_id=comichuddle.actor_user_id());
ALTER TABLE comichuddle.listing_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_item_owner ON comichuddle.listing_items
  USING (seller_id=comichuddle.actor_user_id()) WITH CHECK (seller_id=comichuddle.actor_user_id());
ALTER TABLE comichuddle.review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_owner_read ON comichuddle.review_queue FOR SELECT USING (submitted_by_user_id=comichuddle.actor_user_id());
CREATE POLICY review_owner_insert ON comichuddle.review_queue FOR INSERT WITH CHECK (submitted_by_user_id=comichuddle.actor_user_id() AND status='PENDING');
ALTER TABLE comichuddle.marketplace_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_party_read ON comichuddle.marketplace_orders FOR SELECT USING (seller_id=comichuddle.actor_user_id() OR buyer_id=comichuddle.actor_user_id());
ALTER TABLE comichuddle.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_item_party_read ON comichuddle.order_items FOR SELECT USING
  (EXISTS(SELECT 1 FROM comichuddle.marketplace_orders o WHERE o.id=order_id AND (o.seller_id=comichuddle.actor_user_id() OR o.buyer_id=comichuddle.actor_user_id())));
ALTER TABLE comichuddle.marketplace_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY bid_party_read ON comichuddle.marketplace_bids FOR SELECT USING (bidder_id=comichuddle.actor_user_id() OR
  EXISTS(SELECT 1 FROM comichuddle.marketplace_listings l WHERE l.id=listing_id AND l.seller_id=comichuddle.actor_user_id()));

COMMIT;
