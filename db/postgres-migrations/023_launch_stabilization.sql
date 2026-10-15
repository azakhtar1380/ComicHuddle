-- Additive application state only; preserve catalog and financial history.
CREATE TABLE ch_web.directory_identifiers (
 issue_id bigint NOT NULL, source text NOT NULL, identifier text NOT NULL,
 lookup_key text NOT NULL, supplement text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN ('UPC','EAN','ISBN')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(issue_id,source,identifier)
);
CREATE INDEX directory_identifier_lookup ON ch_web.directory_identifiers(lookup_key,supplement,issue_id);
CREATE TABLE ch_web.directory_identifier_sync (
 id text PRIMARY KEY, last_issue_id bigint NOT NULL DEFAULT 0,
 scanned_count bigint NOT NULL DEFAULT 0, matched_issue_count bigint NOT NULL DEFAULT 0,
 identifier_count bigint NOT NULL DEFAULT 0, completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ch_web.media_renditions (
 media_id text PRIMARY KEY REFERENCES ch_web.media(id), width integer NOT NULL,
 height integer NOT NULL, content_hash text NOT NULL,
 thumbnail_key text NOT NULL, validated_at timestamptz NOT NULL DEFAULT now()
);
-- Retain deferred work and historical pricing records for a later reviewed release.
UPDATE ch_web.enrichment_jobs SET status='DISABLED',last_error_code='launch_scope_deferred',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
 WHERE kind IN ('valuation','pulse') AND status IN ('PENDING','PROCESSING');
