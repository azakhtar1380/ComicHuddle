-- Additive only: member profile pictures. One row per collector profile; the image bytes live in
-- the existing photo store (ch_web.photo_bytes, key 'avatars/<avatar_id>'). No foreign keys, and no
-- change to ch_web.profiles, so code that predates this table keeps working.
CREATE TABLE IF NOT EXISTS ch_web.profile_avatars (
 profile_id text PRIMARY KEY,
 user_id text NOT NULL,
 avatar_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profile_avatars_avatar_unique ON ch_web.profile_avatars (avatar_id);
CREATE INDEX IF NOT EXISTS profile_avatars_user ON ch_web.profile_avatars (user_id);
