-- Each wallet view paginates its own ledger; sandbox activity must not crowd out USD receipts.
CREATE INDEX IF NOT EXISTS collector_wallet_user_mode_time
ON ch_web.collector_wallet_entries(user_id,mode,created_at DESC,id DESC);
