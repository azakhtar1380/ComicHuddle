SET search_path TO ch_web, public;

CREATE TABLE catalog_ingestion_runs (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL,
  expected_records bigint NOT NULL CHECK (expected_records > 0),
  accepted_records bigint NOT NULL DEFAULT 0,
  inserted_records bigint NOT NULL DEFAULT 0,
  retained_records bigint NOT NULL DEFAULT 0,
  next_batch bigint NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'OPEN' CHECK (stage IN ('OPEN', 'COMPLETED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (accepted_records = inserted_records + retained_records),
  CHECK (accepted_records >= 0 AND accepted_records <= expected_records),
  CHECK (inserted_records >= 0 AND retained_records >= 0),
  CHECK ((stage = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (stage <> 'COMPLETED' OR accepted_records = expected_records)
);

CREATE TABLE catalog_ingestion_batches (
  run_id text NOT NULL REFERENCES catalog_ingestion_runs(id),
  batch_index bigint NOT NULL CHECK (batch_index >= 0),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  record_count bigint NOT NULL CHECK (record_count BETWEEN 1 AND 100),
  inserted_records bigint NOT NULL CHECK (inserted_records >= 0),
  retained_records bigint NOT NULL CHECK (retained_records >= 0),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, batch_index),
  CHECK (record_count = inserted_records + retained_records)
);

CREATE INDEX catalog_ingestion_stage ON catalog_ingestion_runs(stage, started_at);
