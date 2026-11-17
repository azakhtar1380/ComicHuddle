-- Additive only: the verification fee. A collector pays it through Stripe Checkout (platform account, not Connect)
-- before their request reaches the admin queue. Approved = kept; declined = refunded in full.
-- Rows become 'paid' only from the signed Stripe webhook (lib/verification-payments.ts).
CREATE TABLE IF NOT EXISTS ch_web.verification_payments (
 id text PRIMARY KEY,
 profile_id text NOT NULL,
 user_id text NOT NULL,
 amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 10000),
 contact_note text NOT NULL DEFAULT '' CHECK (char_length(contact_note) <= 500),
 checkout_session_id text UNIQUE,
 payment_intent_id text UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','refund_pending','refunded','kept')),
 sandbox bigint NOT NULL DEFAULT 1 CHECK (sandbox IN (0,1)),
 created_at timestamptz NOT NULL DEFAULT now(),
 paid_at timestamptz,
 refunded_at timestamptz
);
CREATE INDEX IF NOT EXISTS verification_payments_profile ON ch_web.verification_payments (profile_id, created_at DESC);
