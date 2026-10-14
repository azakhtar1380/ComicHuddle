CREATE TABLE ch_web.catalog_snapshot_imports (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_at timestamptz NOT NULL,
  expected_records bigint NOT NULL CHECK (expected_records > 0),
  accepted_records bigint NOT NULL DEFAULT 0,
  inserted_records bigint NOT NULL DEFAULT 0,
  enriched_records bigint NOT NULL DEFAULT 0,
  retained_records bigint NOT NULL DEFAULT 0,
  next_batch bigint NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'OPEN' CHECK (stage IN ('OPEN','COMPLETED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (accepted_records = inserted_records + enriched_records + retained_records),
  CHECK (accepted_records >= 0 AND accepted_records <= expected_records),
  CHECK (inserted_records >= 0 AND enriched_records >= 0 AND retained_records >= 0),
  CHECK ((stage = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (stage <> 'COMPLETED' OR accepted_records = expected_records)
);
CREATE TABLE ch_web.catalog_snapshot_batches (
  import_id text NOT NULL REFERENCES ch_web.catalog_snapshot_imports(id),
  batch_index bigint NOT NULL CHECK (batch_index >= 0),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  record_count bigint NOT NULL CHECK (record_count BETWEEN 1 AND 500),
  inserted_records bigint NOT NULL CHECK (inserted_records >= 0),
  enriched_records bigint NOT NULL CHECK (enriched_records >= 0),
  retained_records bigint NOT NULL CHECK (retained_records >= 0),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (import_id,batch_index),
  CHECK (record_count = inserted_records + enriched_records + retained_records)
);
CREATE INDEX catalog_snapshot_import_stage ON ch_web.catalog_snapshot_imports(stage,started_at);
-- PostgreSQL can use this expression index for substring search at scale when
-- pg_trgm is already installed by an operator. The baseline B-tree indexes in
-- 001 remain valid; importing a dump never attempts privileged extensions.
