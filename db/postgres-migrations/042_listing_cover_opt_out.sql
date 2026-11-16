-- Additive only: a seller can keep a listing's front photo out of the public directory.
-- 0 (default) = the front photo may become that issue's directory cover; 1 = keep it on the listing only.
-- Code that predates this column ignores it; the cover query treats a missing column as "no seller covers".
ALTER TABLE ch_web.listings ADD COLUMN IF NOT EXISTS cover_opt_out bigint NOT NULL DEFAULT 0 CHECK (cover_opt_out IN (0,1));
