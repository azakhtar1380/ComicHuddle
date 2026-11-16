-- Additive only: verified checkmark for individual collectors (businesses keep ch_web.business_profiles).
-- A collector asks to be verified (pending); ComicHuddle contacts them to confirm they're a real person and an
-- admin turns the check on by hand. Statuses match businesses: unverified | pending | verified | revoked.
-- Every change is recorded in ch_web.business_verification_events with action prefixed "person_".
CREATE TABLE IF NOT EXISTS ch_web.person_verifications (
 profile_id text PRIMARY KEY,
 user_id text NOT NULL,
 status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','pending','verified','revoked')),
 contact_note text NOT NULL DEFAULT '' CHECK (char_length(contact_note) <= 500),
 admin_note text NOT NULL DEFAULT '' CHECK (char_length(admin_note) <= 500),
 requested_at timestamptz NULL,
 verified_at timestamptz NULL,
 verified_by text NULL,
 status_changed_at timestamptz NULL,
 status_changed_by text NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS person_verifications_status ON ch_web.person_verifications (status, updated_at DESC);
