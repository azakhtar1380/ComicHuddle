-- Additive only: free visual scanner index for GCD catalog issues (4000000000+gcd id).
-- Same shape as ch_web.catalog_cover_features, without the FK to the small curated
-- catalog_issues table. Filled from the owner's own S3 cover copies by
-- scripts/index-metron-cover-features.ts; read by /api/recognition alongside the curated index.
CREATE TABLE IF NOT EXISTS ch_web.catalog_visual_features (
 issue_id bigint PRIMARY KEY,
 descriptor_version integer NOT NULL DEFAULT 2 CHECK (descriptor_version=2),
 phash bit(64) NOT NULL,
 descriptor jsonb NOT NULL CHECK (jsonb_typeof(descriptor)='object'),
 image_url text NOT NULL,
 image_sha256 char(64) NOT NULL,
 source_url text NOT NULL,
 attribution text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ch_web.catalog_visual_feature_bands (
 issue_id bigint NOT NULL REFERENCES ch_web.catalog_visual_features(issue_id) ON DELETE CASCADE,
 band smallint NOT NULL CHECK (band BETWEEN 0 AND 7),
 bucket bit(8) NOT NULL,
 PRIMARY KEY(issue_id,band)
);
CREATE INDEX IF NOT EXISTS catalog_visual_bands_lookup ON ch_web.catalog_visual_feature_bands(band,bucket,issue_id);
