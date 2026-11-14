-- Additive only: index of Metron cover images copied to the owner's own S3 bucket
-- (served through CloudFront at METRON_COVER_CDN_BASE). Rows come from the
-- copier's manifest (scripts/copy-metron-covers.mjs -> scripts/import-metron-covers.ts).
-- issue_id is the ComicHuddle catalog id (4000000000 + GCD issue id for native rows)
-- and is set only for an exact link or a unique series/year/number match.
-- No foreign keys: existing catalog, GCD and cover tables are not touched.
CREATE TABLE IF NOT EXISTS ch_web.metron_cover_index (
 metron_id integer PRIMARY KEY,
 series text,
 volume integer,
 year_began integer,
 number text,
 cover_date date,
 cover_hash text,
 card jsonb,
 dense jsonb,
 issue_id bigint NULL,
 match_method text NULL,
 imported_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metron_cover_index_issue ON ch_web.metron_cover_index(issue_id);
