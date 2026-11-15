-- Messaging extras (lib/conversations.ts). Additive only; the app works without these tables
-- (no read receipts, no archive, no photo messages) until this migration is applied.

-- Per-member conversation markers: how far they have read, and whether they archived it.
-- Timestamps are ISO-8601 text to compare directly with ch_web.messages.created_at.
CREATE TABLE IF NOT EXISTS ch_web.conversation_states (
 thread_id text NOT NULL,
 profile_id text NOT NULL,
 read_at text,
 archived_at text,
 PRIMARY KEY (thread_id, profile_id)
);
CREATE INDEX IF NOT EXISTS conversation_states_profile ON ch_web.conversation_states (profile_id);

-- Photos attached to a private message. The photo is served only to the two participants
-- through /api/social/attachment, and only while the message exists.
CREATE TABLE IF NOT EXISTS ch_web.message_attachments (
 message_id text NOT NULL,
 position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
 media_id text NOT NULL,
 PRIMARY KEY (message_id, position)
);
CREATE INDEX IF NOT EXISTS message_attachments_media ON ch_web.message_attachments (media_id);
