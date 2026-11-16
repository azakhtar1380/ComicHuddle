-- Additive only: the new My Profile page (cover photo, tags, favorite character and comic, grail poster,
-- and what the public link shows). One row per profile; no foreign keys and no change to ch_web.profiles,
-- so older code keeps working. Cover image bytes live in the existing photo store under profile-covers/<cover_id>.
CREATE TABLE IF NOT EXISTS ch_web.profile_extras (
 profile_id text PRIMARY KEY,
 user_id text NOT NULL,
 cover_id text NULL,
 tags jsonb NOT NULL DEFAULT '[]'::jsonb,
 favorite_character_id integer NULL,
 favorite_issue_id bigint NULL,
 grail_issue_id bigint NULL,
 grail_reward text NOT NULL DEFAULT '',
 share_wishlist boolean NOT NULL DEFAULT true,
 share_reviews boolean NOT NULL DEFAULT true,
 share_city boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profile_extras_cover_unique ON ch_web.profile_extras (cover_id) WHERE cover_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profile_extras_user ON ch_web.profile_extras (user_id);
