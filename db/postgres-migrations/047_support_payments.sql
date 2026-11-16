-- Additive only: "Support ComicHuddle" one-time payments to ComicHuddle (Malik LLC) itself. Not Connect, no seller,
-- no fee split, never wallet balance, points or store credit. A row is created as 'pending' when checkout starts and
-- becomes 'paid' only from the signed Stripe webhook (lib/support-payments.ts).
CREATE TABLE IF NOT EXISTS ch_web.support_payments (
 id text PRIMARY KEY,
 checkout_session_id text UNIQUE,
 payment_intent_id text UNIQUE,
 amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 50000),
 user_id text,
 supporter_name text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','refunded')),
 sandbox bigint NOT NULL DEFAULT 1 CHECK (sandbox IN (0,1)),
 created_at timestamptz NOT NULL DEFAULT now(),
 paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_payments_user ON ch_web.support_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_payments_paid ON ch_web.support_payments (status, paid_at DESC);
