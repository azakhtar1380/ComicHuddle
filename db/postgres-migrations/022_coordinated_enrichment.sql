-- Application state only. Imported gcd tables are never altered by this migration.
CREATE TABLE ch_web.enrichment_catalog_refs (
 issue_id bigint PRIMARY KEY CHECK(issue_id>=0), source_provider text NOT NULL,
 source_id bigint, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_web.source_permissions (
 provider text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 access_allowed boolean NOT NULL DEFAULT false, cache_allowed boolean NOT NULL DEFAULT false,
 display_allowed boolean NOT NULL DEFAULT false, ai_allowed boolean NOT NULL DEFAULT false,
 valuation_allowed boolean NOT NULL DEFAULT false, evidence_reference text NOT NULL,
 attribution text NOT NULL, approved_hosts jsonb NOT NULL DEFAULT '[]',
 valid_until timestamptz NOT NULL, revoked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_web.enrichment_jobs (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('cover','valuation','pulse')),
 job_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','PROCESSING','DONE','FAILED','BLOCKED','DISABLED')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_expires_at timestamptz, last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,job_key)
);
CREATE INDEX enrichment_jobs_due ON ch_web.enrichment_jobs(kind,available_at,created_at) WHERE status IN ('PENDING','PROCESSING');
CREATE TABLE ch_web.enrichment_provider_limits (
 provider text PRIMARY KEY, next_request_at timestamptz NOT NULL DEFAULT now(),
 blocked_until timestamptz, error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_web.cover_cache (
 id uuid PRIMARY KEY, issue_id bigint NOT NULL REFERENCES ch_web.enrichment_catalog_refs(issue_id),
 source_provider text NOT NULL REFERENCES ch_web.source_permissions(provider), source_cover_id text NOT NULL,
 source_url text, permission_reference text NOT NULL, status text NOT NULL
 CHECK(status IN ('PENDING','PROCESSING','CACHED','NOT_FOUND','BLOCKED','RATE_LIMITED','FAILED','DISABLED')),
 storage_bucket text, renditions jsonb NOT NULL DEFAULT '{}', content_hash text,
 mime_type text, width integer, height integer, byte_size integer,
 etag text, last_modified text, last_checked_at timestamptz, last_success_at timestamptz,
 next_retry_at timestamptz, attempt_count integer NOT NULL DEFAULT 0, lease_expires_at timestamptz,
 last_http_status integer, sanitized_error_code text, attribution text NOT NULL,
 permission_expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issue_id,source_provider,source_cover_id)
);
CREATE INDEX cover_cache_issue_status ON ch_web.cover_cache(issue_id,status);
CREATE INDEX cover_cache_retry ON ch_web.cover_cache(next_retry_at) WHERE status IN ('FAILED','RATE_LIMITED');
CREATE TABLE ch_web.valuation_snapshots (
 id uuid PRIMARY KEY, target_key text NOT NULL, target jsonb NOT NULL, status text NOT NULL,
 low_cents bigint, high_cents bigint, currency text NOT NULL DEFAULT 'USD',
 evidence jsonb NOT NULL DEFAULT '{}', evidence_kind text NOT NULL DEFAULT 'none',
 sample_count integer NOT NULL DEFAULT 0, independent_count integer NOT NULL DEFAULT 0,
 evidence_oldest_at timestamptz, evidence_newest_at timestamptz,
 calculated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 model text, methodology text NOT NULL, explanation text NOT NULL,
 assumptions jsonb NOT NULL DEFAULT '[]',
 CHECK((low_cents IS NULL AND high_cents IS NULL) OR (low_cents>0 AND high_cents>=low_cents))
);
CREATE INDEX valuation_snapshot_target ON ch_web.valuation_snapshots(target_key,calculated_at DESC);
CREATE TABLE ch_web.valuation_targets (
 target_key text PRIMARY KEY, issue_id bigint NOT NULL REFERENCES ch_web.enrichment_catalog_refs(issue_id),
 target jsonb NOT NULL, snapshot_id uuid REFERENCES ch_web.valuation_snapshots(id),
 status text NOT NULL, next_refresh_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Original, reviewed observations only. No asking prices or earlier AI estimates.
CREATE TABLE ch_web.valuation_observations (
 id text PRIMARY KEY, target_key text NOT NULL, source_provider text NOT NULL REFERENCES ch_web.source_permissions(provider),
 kind text NOT NULL CHECK(kind IN ('sale','reviewed_baseline')), low_cents bigint NOT NULL CHECK(low_cents>0),
 high_cents bigint NOT NULL CHECK(high_cents>=low_cents), currency text NOT NULL CHECK(currency='USD'),
 observed_at timestamptz NOT NULL, independent_entity_key text NOT NULL,
 source_url text, evidence_reference text NOT NULL, eligible boolean NOT NULL DEFAULT false,
 details jsonb NOT NULL DEFAULT '{}',
 original_observation boolean NOT NULL DEFAULT true, reviewed_at timestamptz, expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX valuation_observation_target ON ch_web.valuation_observations(target_key,observed_at DESC) WHERE eligible;
CREATE TABLE ch_web.listing_estimates (
 composition_version text PRIMARY KEY, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_web.collector_listing_drafts (
 user_id text PRIMARY KEY, revision uuid NOT NULL, data jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_web.collector_activity (
 id uuid PRIMARY KEY, actor_key text NOT NULL, issue_id bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('grail','view')), observed_day date NOT NULL DEFAULT CURRENT_DATE,
 observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(actor_key,issue_id,kind,observed_day)
);
CREATE INDEX collector_activity_window ON ch_web.collector_activity(kind,observed_at,issue_id);
CREATE TABLE ch_web.market_pulse_snapshots (
 id text PRIMARY KEY, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, ai_summary jsonb, ai_status text NOT NULL DEFAULT 'not_requested'
);
CREATE TABLE ch_web.enrichment_ai_usage (
 id uuid PRIMARY KEY, purpose text NOT NULL, model text NOT NULL, reserved_cents integer NOT NULL,
 input_tokens integer, output_tokens integer, latency_ms integer, outcome text NOT NULL DEFAULT 'reserved',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrichment_ai_usage_day ON ch_web.enrichment_ai_usage(created_at,purpose);
CREATE TABLE ch_web.enrichment_daily_budgets(day date PRIMARY KEY,reserved_cents integer NOT NULL DEFAULT 0);
CREATE TABLE ch_web.enrichment_metrics(day date NOT NULL DEFAULT CURRENT_DATE,name text NOT NULL,count bigint NOT NULL DEFAULT 0,PRIMARY KEY(day,name));
CREATE TABLE ch_web.scanner_outcomes (
 id uuid PRIMARY KEY, actor_key text NOT NULL, result text NOT NULL CHECK(result IN ('confirmed','corrected','no_match')),
 issue_id bigint, model text, elapsed_ms integer, created_at timestamptz NOT NULL DEFAULT now()
);
