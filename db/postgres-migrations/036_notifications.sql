-- Additive only: in-app notifications (new offers and replies, order updates, SafePurchase steps,
-- tracking, payouts). One row per recipient account. No foreign keys; existing tables untouched.
CREATE TABLE IF NOT EXISTS ch_web.notifications (
 id text PRIMARY KEY,
 user_id text NOT NULL,
 kind text NOT NULL,
 title text NOT NULL,
 body text NOT NULL DEFAULT '',
 href text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_time ON ch_web.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread ON ch_web.notifications (user_id) WHERE read_at IS NULL;
