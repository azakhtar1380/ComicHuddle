-- eBay-style order feedback. One buyer→seller entry and one seller→buyer entry per order.
-- Eligibility (completed order, 60-day window, 30-day edit lock) is enforced in lib/seller-feedback.ts;
-- the table enforces shape, uniqueness, no self-feedback and positive-only seller→buyer feedback.
CREATE TABLE IF NOT EXISTS ch_web.order_feedback (
 id text PRIMARY KEY,
 order_id text NOT NULL REFERENCES ch_web.commerce_orders(id),
 direction text NOT NULL CHECK (direction IN ('buyer_to_seller','seller_to_buyer')),
 author_profile_id text NOT NULL,
 subject_profile_id text NOT NULL,
 rating text NOT NULL CHECK (rating IN ('positive','neutral','negative')),
 item_as_described smallint CHECK (item_as_described BETWEEN 1 AND 5),
 communication smallint CHECK (communication BETWEEN 1 AND 5),
 shipping_speed smallint CHECK (shipping_speed BETWEEN 1 AND 5),
 comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
 reply text CHECK (reply IS NULL OR char_length(reply) BETWEEN 1 AND 500),
 reply_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT order_feedback_one_per_direction UNIQUE (order_id, direction),
 CONSTRAINT order_feedback_not_self CHECK (author_profile_id <> subject_profile_id),
 CONSTRAINT order_feedback_seller_positive_only CHECK (direction = 'buyer_to_seller' OR (rating = 'positive' AND item_as_described IS NULL AND communication IS NULL AND shipping_speed IS NULL AND reply IS NULL))
);
CREATE INDEX IF NOT EXISTS order_feedback_subject ON ch_web.order_feedback (subject_profile_id, direction, created_at DESC);
COMMENT ON TABLE ch_web.order_feedback IS 'Public order feedback. Never expose order_id or order amounts through public APIs.';
