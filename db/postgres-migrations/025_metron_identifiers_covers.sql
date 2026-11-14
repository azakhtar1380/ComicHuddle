-- Additive only: Metron barcode fallback cache, shared provider request budget,
-- and a DISABLED placeholder permission row so Metron cover rows satisfy the
-- existing cover_cache foreign key. This row grants nothing: every flag is false.
-- Interim direct display is controlled only by the owner's COVER_DIRECT_DISPLAY=metron.
INSERT INTO ch_web.source_permissions(provider,enabled,access_allowed,cache_allowed,display_allowed,ai_allowed,valuation_allowed,evidence_reference,attribution,approved_hosts,valid_until)
VALUES('METRON',false,false,false,false,false,false,'unreviewed placeholder - no grant','Cover image © its publisher and creators. Located via Metron (metron.cloud).','["metron.cloud","static.metron.cloud"]',now()+interval '50 years')
ON CONFLICT(provider) DO NOTHING;

-- One row per scanned barcode (base lookup key + supplement). Positive and
-- negative results are cached so each barcode costs at most one Metron lookup
-- per expiry period.
CREATE TABLE IF NOT EXISTS ch_web.metron_identifier_lookups (
 lookup_key text NOT NULL, supplement text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('MATCHED','EXTERNAL','NOT_FOUND')),
 issue_ids jsonb NOT NULL DEFAULT '[]', candidates jsonb NOT NULL DEFAULT '[]',
 total integer NOT NULL DEFAULT 0, checked_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, PRIMARY KEY(lookup_key,supplement)
);

-- Per-minute and per-day request counters shared by every server-side caller
-- of a provider (barcode fallback and cover resolution).
CREATE TABLE IF NOT EXISTS ch_web.provider_request_windows (
 provider text NOT NULL, window_kind text NOT NULL CHECK(window_kind IN ('minute','day')),
 window_start timestamptz NOT NULL, requests integer NOT NULL DEFAULT 0,
 PRIMARY KEY(provider,window_kind,window_start)
);
