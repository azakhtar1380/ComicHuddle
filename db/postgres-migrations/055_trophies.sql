-- Additive only: Trophies (definitions live in lib/trophy-defs.ts).
-- user_trophies: one row per user, trophy and tier. earned_at is NULL for a tier that is only being
-- tracked for its "Almost there" nudge. revoked_at hides a tier whose count dropped (quietly) or that an
-- admin revoked (revoked_by set; awards never clear an admin revocation, only an admin restore does).
CREATE TABLE IF NOT EXISTS ch_web.user_trophies (
 user_id text NOT NULL,
 trophy text NOT NULL,
 tier text NOT NULL CHECK (tier IN ('bronze','silver','golden','single')),
 earned_at timestamptz NULL,
 seen_at timestamptz NULL,
 revoked_at timestamptz NULL,
 revoked_by text NULL,
 nudged_at timestamptz NULL,
 PRIMARY KEY (user_id, trophy, tier)
);
CREATE INDEX IF NOT EXISTS user_trophies_unseen ON ch_web.user_trophies (user_id, earned_at) WHERE earned_at IS NOT NULL AND seen_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_trophies_holders ON ch_web.user_trophies (trophy, tier) WHERE earned_at IS NOT NULL AND revoked_at IS NULL;

-- Notification switches on the trophy page.
CREATE TABLE IF NOT EXISTS ch_web.trophy_prefs (
 user_id text PRIMARY KEY,
 unlocks boolean NOT NULL DEFAULT true,
 almost boolean NOT NULL DEFAULT true,
 weekly boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- "{x}% of collectors have this tier", computed by the daily cron.
CREATE TABLE IF NOT EXISTS ch_web.trophy_stats (
 trophy text NOT NULL,
 tier text NOT NULL,
 holders integer NOT NULL,
 collectors integer NOT NULL,
 computed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (trophy, tier)
);

-- Wishlist history kept with every vault save, so Grail Hunter can check an issue was wanted before checkout.
CREATE TABLE IF NOT EXISTS ch_web.vault_wants (
 user_id text NOT NULL,
 issue_id bigint NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz NULL,
 PRIMARY KEY (user_id, issue_id)
);
