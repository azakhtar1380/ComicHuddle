-- Additive only: the one-time "Your origin story is still blank!" nudge and its snooze
-- ("Remind me after my next haul": snoozed until the member next adds comics).
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS origin_nudged_at timestamptz NULL;
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS origin_snoozed_at timestamptz NULL;
