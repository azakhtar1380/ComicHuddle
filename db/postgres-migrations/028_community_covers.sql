-- Additive only: collector-submitted cover photos for Directory issues without a cover.
-- Image bytes live in ch_web.photo_bytes under the media id (served by /api/media);
-- no foreign keys to existing tables, so account/media deletion flows are unchanged.
-- Display rules (most recent approved per issue, below reviewed/licensed sources) are in lib/community-covers.ts.
CREATE TABLE IF NOT EXISTS ch_web.community_covers (
 id text PRIMARY KEY,
 issue_id bigint NOT NULL CHECK (issue_id >= 0),
 media_id text NOT NULL UNIQUE,
 user_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden')),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 1200),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 1200),
 content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
 report_count integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_covers_issue_status ON ch_web.community_covers (issue_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS community_covers_user_time ON ch_web.community_covers (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ch_web.community_cover_reports (
 cover_id text NOT NULL REFERENCES ch_web.community_covers(id) ON DELETE CASCADE,
 reporter_user_id text NOT NULL,
 reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (cover_id, reporter_user_id)
);
COMMENT ON TABLE ch_web.community_covers IS 'Collector-submitted Directory cover photos. Never expose user_id through public APIs.';
