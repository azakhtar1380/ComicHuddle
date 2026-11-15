-- Additive only: comic character data (Metron, CC BY-SA 4.0; Wikidata, CC0) for issue
-- profiles ("Key Issue", first appearances, "Inside this issue"), character search and
-- the directory character filter. Written by scripts/import-characters.ts,
-- scripts/import-wikidata-first-appearances.ts and the on-demand profile enrichment.
-- issue_id is the ComicHuddle catalog id (4000000000 + GCD issue id). No foreign keys:
-- existing catalog, GCD and cover tables are not touched.

-- Shared daily Metron API budget (UTC day) for the local crawler and the deployed app.
CREATE TABLE IF NOT EXISTS ch_web.metron_api_budget (
 day date PRIMARY KEY,
 used integer NOT NULL DEFAULT 0,
 by_caller jsonb NOT NULL DEFAULT '{}'::jsonb,
 minute_start timestamptz NULL,
 minute_used integer NOT NULL DEFAULT 0,
 blocked_until timestamptz NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- character_id: the Metron character id (> 0), or -<Wikidata Q number> for a character
-- known only from Wikidata. merged_into points a Wikidata-only row at its Metron twin.
CREATE TABLE IF NOT EXISTS ch_web.characters (
 character_id integer PRIMARY KEY,
 metron_id integer NULL,
 wikidata_qid text NULL,
 merged_into integer NULL,
 name text NOT NULL,
 aliases text[] NOT NULL DEFAULT '{}',
 search_text text NOT NULL DEFAULT '',
 description text NULL,
 image_url text NULL,
 portrait_key text NULL,
 issue_count integer NULL,
 first_metron_issue_id integer NULL,
 sitelinks integer NULL,
 modified timestamptz NULL,
 detail_fetched_at timestamptz NULL,
 issues_fetched_at timestamptz NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_metron_id ON ch_web.characters(metron_id) WHERE metron_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS characters_wikidata_qid ON ch_web.characters(wikidata_qid) WHERE wikidata_qid IS NOT NULL;
-- Trigram index only where pg_trgm is installed (it is on RDS; test engines may lack it).
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
  EXECUTE 'CREATE INDEX IF NOT EXISTS characters_search_trgm ON ch_web.characters USING gin(search_text gin_trgm_ops)';
 END IF;
END$$;
CREATE INDEX IF NOT EXISTS characters_name_prefix ON ch_web.characters(lower(name) text_pattern_ops);

-- One first-appearance fact per character and source, with provenance.
CREATE TABLE IF NOT EXISTS ch_web.character_first_appearances (
 character_id integer NOT NULL,
 source text NOT NULL CHECK(source IN ('metron','wikidata')),
 source_ref text NOT NULL,
 issue_id bigint NULL,
 metron_issue_id integer NULL,
 series text NULL,
 number text NULL,
 year integer NULL,
 match_method text NULL,
 suppressed boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(character_id,source)
);
CREATE INDEX IF NOT EXISTS character_first_appearances_issue ON ch_web.character_first_appearances(issue_id) WHERE issue_id IS NOT NULL;

-- Every harvested Metron issue linked to a catalog issue (exact or unique series/year/number match).
CREATE TABLE IF NOT EXISTS ch_web.character_metron_issues (
 metron_id integer PRIMARY KEY,
 series text NULL,
 volume integer NULL,
 year_began integer NULL,
 number text NULL,
 cover_date date NULL,
 issue_id bigint NULL,
 match_method text NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS character_metron_issues_issue ON ch_web.character_metron_issues(issue_id) WHERE issue_id IS NOT NULL;

-- Metron issue details (characters, teams, credits, description).
CREATE TABLE IF NOT EXISTS ch_web.metron_issue_details (
 metron_id integer PRIMARY KEY,
 issue_id bigint NULL,
 description text NULL,
 characters jsonb NOT NULL DEFAULT '[]'::jsonb,
 teams jsonb NOT NULL DEFAULT '[]'::jsonb,
 credits jsonb NOT NULL DEFAULT '[]'::jsonb,
 fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metron_issue_details_issue ON ch_web.metron_issue_details(issue_id) WHERE issue_id IS NOT NULL;

-- Raw Metron appearances (issue details and character issue lists), by Metron issue id.
CREATE TABLE IF NOT EXISTS ch_web.character_appearances (
 character_id integer NOT NULL,
 metron_issue_id integer NOT NULL,
 PRIMARY KEY(character_id,metron_issue_id)
);
CREATE INDEX IF NOT EXISTS character_appearances_issue ON ch_web.character_appearances(metron_issue_id);

-- Catalog issues known to contain a character (directory filter), derived from the above.
CREATE TABLE IF NOT EXISTS ch_web.character_issues (
 character_id integer NOT NULL,
 issue_id bigint NOT NULL,
 PRIMARY KEY(character_id,issue_id)
);
CREATE INDEX IF NOT EXISTS character_issues_issue ON ch_web.character_issues(issue_id);

-- Issues requested by the profile API whose Metron details are not fetched yet.
CREATE TABLE IF NOT EXISTS ch_web.character_enrichment_queue (
 metron_issue_id integer PRIMARY KEY,
 issue_id bigint NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 last_attempt_at timestamptz NULL,
 attempts integer NOT NULL DEFAULT 0,
 last_error text NULL
);
