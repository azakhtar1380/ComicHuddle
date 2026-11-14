-- Additive: allow live-mode orders (sandbox = 0) alongside test-mode orders (sandbox = 1).
-- Existing rows are unchanged. The application only creates live orders when
-- COMMERCE_STRIPE_MODE=live and COMMERCE_LIVE_REVIEWED=true; wallet/reward functions from
-- 011_collector_rewards already map sandbox=0 to the 'live' ledger mode.
ALTER TABLE ch_web.commerce_orders DROP CONSTRAINT IF EXISTS commerce_sandbox_only;
ALTER TABLE ch_web.commerce_orders ADD CONSTRAINT commerce_sandbox_mode CHECK (sandbox IN (0,1));
