-- Additive only (round 4, SafePurchase + admin): an audit log of every admin action, and the SafePurchase
-- order timeline updates admins post (notes, tracking numbers, photos). Order money and protection state
-- stay in commerce_orders / commerce_events; these tables never change an order by themselves.
-- No foreign keys; existing tables untouched.
CREATE TABLE IF NOT EXISTS ch_web.admin_audit_log (
 id text PRIMARY KEY,
 admin_user_id text NOT NULL,
 founder boolean NOT NULL DEFAULT false,
 action text NOT NULL,
 target_type text NOT NULL DEFAULT '',
 target_id text NOT NULL DEFAULT '',
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_time ON ch_web.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target ON ch_web.admin_audit_log (target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ch_web.safepurchase_updates (
 id text PRIMARY KEY,
 order_id text NOT NULL,
 step text NOT NULL,
 kind text NOT NULL DEFAULT 'note',
 internal boolean NOT NULL DEFAULT false,
 note text NOT NULL DEFAULT '',
 carrier text NULL,
 tracking_number text NULL,
 photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safepurchase_updates_order ON ch_web.safepurchase_updates (order_id, created_at);
