-- Display name and @handle changes (cleanup round). Safe to re-run.
-- Regular members get 2 name changes and 2 handle changes for the life of the account (setting them when the
-- profile is created doesn't count); admins and the Founder are unlimited. Every real change is kept in
-- profile_name_history, which also drives the 30-day handle reservation and the 90-day /@old → /@new redirect.
ALTER TABLE ch_web.profiles ADD COLUMN IF NOT EXISTS name_changes integer NOT NULL DEFAULT 0;
ALTER TABLE ch_web.profiles ADD COLUMN IF NOT EXISTS handle_changes integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ch_web.profile_name_history (
 id text PRIMARY KEY,
 profile_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('name','handle')),
 old_value text NOT NULL,
 new_value text NOT NULL,
 changed_by text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_name_history_profile ON ch_web.profile_name_history(profile_id,changed_at DESC);
CREATE INDEX IF NOT EXISTS profile_name_history_old_handle ON ch_web.profile_name_history(lower(old_value),changed_at DESC) WHERE kind='handle';
