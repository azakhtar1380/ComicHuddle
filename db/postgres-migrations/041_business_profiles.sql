-- Additive only: personal (collector) or business (comic shop / dealer) profiles, and the verified tick.
-- One row per collector profile that has chosen an account type. No row = collector. No foreign keys and
-- no change to ch_web.profiles, so code that predates these tables keeps working (lib/business-profile.ts
-- treats a missing table as "everyone is a collector, nobody is verified").
--
-- Verification is structured so it can be automated later: verification_status + verification_source
-- (today only 'admin_manual'), verification_ref for an external check id, and who/when columns. Every grant
-- or removal is also written to ch_web.business_verification_events (append-only audit trail).
CREATE TABLE IF NOT EXISTS ch_web.business_profiles (
 profile_id text PRIMARY KEY,
 user_id text NOT NULL,
 account_type text NOT NULL DEFAULT 'collector',
 business_kind text NOT NULL DEFAULT 'shop',
 shop_name text NOT NULL DEFAULT '',
 logo_media_id text NULL,
 city text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT '',
 website text NOT NULL DEFAULT '',
 shipping_policy text NOT NULL DEFAULT '',
 returns_policy text NOT NULL DEFAULT '',
 verification_status text NOT NULL DEFAULT 'unverified',
 verification_source text NULL,
 verification_ref text NULL,
 verification_note text NOT NULL DEFAULT '',
 verified_at timestamptz NULL,
 verified_by text NULL,
 status_changed_at timestamptz NULL,
 status_changed_by text NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT business_profiles_account_type CHECK (account_type IN ('collector','business')),
 CONSTRAINT business_profiles_kind CHECK (business_kind IN ('shop','dealer')),
 CONSTRAINT business_profiles_status CHECK (verification_status IN ('unverified','pending','verified','revoked'))
);
CREATE INDEX IF NOT EXISTS business_profiles_user ON ch_web.business_profiles (user_id);
CREATE INDEX IF NOT EXISTS business_profiles_type_status ON ch_web.business_profiles (account_type, verification_status);

CREATE TABLE IF NOT EXISTS ch_web.business_verification_events (
 id text PRIMARY KEY,
 profile_id text NOT NULL,
 action text NOT NULL,
 status text NOT NULL,
 source text NOT NULL,
 actor_user_id text NULL,
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_verification_events_profile ON ch_web.business_verification_events (profile_id, created_at DESC);
