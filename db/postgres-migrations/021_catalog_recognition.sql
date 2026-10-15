-- A derived visual index, linked to exact central catalog identities.
-- Images stay in their permitted storage; this table stores numerical features.
CREATE TABLE IF NOT EXISTS ch_web.catalog_cover_features (
 issue_id bigint PRIMARY KEY REFERENCES ch_web.catalog_issues(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS ch_web.catalog_cover_feature_bands (
 issue_id bigint NOT NULL REFERENCES ch_web.catalog_cover_features(issue_id) ON DELETE CASCADE,
 band smallint NOT NULL CHECK (band BETWEEN 0 AND 7),
 bucket bit(8) NOT NULL,
 PRIMARY KEY(issue_id,band)
);
CREATE INDEX IF NOT EXISTS catalog_cover_bands_lookup ON ch_web.catalog_cover_feature_bands(band,bucket,issue_id);
CREATE TABLE IF NOT EXISTS ch_web.catalog_scan_rate_limits (
 client_key char(64) PRIMARY KEY,
 window_start timestamptz NOT NULL,
 requests integer NOT NULL CHECK (requests>0)
);
CREATE INDEX IF NOT EXISTS catalog_scan_rate_window ON ch_web.catalog_scan_rate_limits(window_start);
COMMENT ON TABLE ch_web.catalog_cover_features IS 'Derived pHash/features from exact, permitted cover assets. Recognition is identification assistance, never authentication or grading.';
