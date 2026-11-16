-- Additive only: several private listing drafts per seller (the Drafts section on the marketplace).
-- The older one-draft table (collector_listing_drafts, migration 022) stays; its row is moved into this table
-- the first time the seller's drafts are read, and editing a live listing still writes there first.
CREATE TABLE IF NOT EXISTS ch_web.listing_drafts (
 id uuid PRIMARY KEY,
 user_id text NOT NULL,
 revision uuid NOT NULL,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_drafts_user_time ON ch_web.listing_drafts (user_id, updated_at DESC);
