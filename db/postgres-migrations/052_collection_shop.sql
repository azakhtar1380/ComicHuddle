-- Additive only: My Collection as "your comic shop".
-- 1. Shop window (what profile visitors see on the Collection tab): open | window | closed. Default window.
-- 2. Runs the member is building: a Directory series and an issue range. Owned and missing issues are
--    always computed from the vault, never stored here.
-- 3. A per-copy ledger kept in step with every vault save: when each copy was added (New arrivals, the
--    "first comic" trophy), when it was removed (copies deleted within 24 hours don't count toward trophies),
--    its Directory issue, and its normalized slab cert (a cert counts once across the site).
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS shop_window text NOT NULL DEFAULT 'window';
DO $$BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profile_extras_shop_window_valid') THEN
  ALTER TABLE ch_web.profile_extras ADD CONSTRAINT profile_extras_shop_window_valid CHECK (shop_window IN ('open','window','closed'));
 END IF;
END$$;

CREATE TABLE IF NOT EXISTS ch_web.collection_runs (
 id text PRIMARY KEY,
 user_id text NOT NULL,
 title text NOT NULL,
 publisher text NOT NULL DEFAULT '',
 series_name text NOT NULL,
 series_year integer NULL,
 gcd_series_id integer NULL,
 from_number integer NOT NULL,
 to_number integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT collection_runs_range_valid CHECK (from_number >= 0 AND to_number >= from_number AND to_number - from_number < 1000)
);
CREATE INDEX IF NOT EXISTS collection_runs_user ON ch_web.collection_runs (user_id, created_at);

CREATE TABLE IF NOT EXISTS ch_web.vault_copies (
 user_id text NOT NULL,
 book_id text NOT NULL,
 directory_issue_id bigint NULL,
 graded boolean NOT NULL DEFAULT false,
 cert text NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz NULL,
 backfilled boolean NOT NULL DEFAULT false,
 PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS vault_copies_cert ON ch_web.vault_copies (cert, added_at) WHERE cert IS NOT NULL;
CREATE INDEX IF NOT EXISTS vault_copies_user_added ON ch_web.vault_copies (user_id, added_at DESC);
