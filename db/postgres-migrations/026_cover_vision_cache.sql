-- Additive only: cache of AI cover identifications keyed by the photo's SHA-256.
-- Stores the structured identification JSON only; the photo itself is never stored.
CREATE TABLE IF NOT EXISTS ch_web.cover_vision_cache (
 image_sha256 text PRIMARY KEY CHECK(image_sha256 ~ '^[a-f0-9]{64}$'),
 provider text NOT NULL, model text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS cover_vision_cache_expiry ON ch_web.cover_vision_cache(expires_at);
