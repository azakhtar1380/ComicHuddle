-- Closed-loop promotional rewards. These balances cannot be cashed out.
CREATE TABLE ch_web.reward_accounts (
 user_id text NOT NULL REFERENCES ch_web.profiles(user_id),
 mode text NOT NULL CHECK(mode IN ('live','sandbox')),
 points_balance bigint NOT NULL DEFAULT 0 CHECK(points_balance BETWEEN -1000000000 AND 1000000000),
 credit_cents bigint NOT NULL DEFAULT 0 CHECK(credit_cents BETWEEN 0 AND 100000000),
 reserved_cents bigint NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=credit_cents),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,mode)
);
CREATE TABLE ch_web.reward_ledger (
 id text PRIMARY KEY,user_id text NOT NULL,mode text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('purchase_points','points_conversion','credit_spend','credit_restore','points_reversal')),
 reference text NOT NULL,order_id text REFERENCES ch_web.commerce_orders(id),
 points_delta bigint NOT NULL DEFAULT 0,credit_delta bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,mode) REFERENCES ch_web.reward_accounts(user_id,mode),UNIQUE(user_id,mode,kind,reference)
);
CREATE INDEX reward_ledger_user_time ON ch_web.reward_ledger(user_id,mode,created_at DESC,id);
CREATE TABLE ch_web.credit_reservations (
 order_id text PRIMARY KEY REFERENCES ch_web.commerce_orders(id),user_id text NOT NULL,mode text NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','spent','released','restored')),
 FOREIGN KEY(user_id,mode) REFERENCES ch_web.reward_accounts(user_id,mode),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION ch_web.convert_reward_points(p_user text,p_mode text,p_request text,p_points bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE account ch_web.reward_accounts; prior ch_web.reward_ledger;
BEGIN
 IF p_mode NOT IN ('live','sandbox') OR p_points<100 OR p_points>1000000 OR p_points%100<>0 THEN RAISE EXCEPTION 'Choose points in blocks of 100' USING ERRCODE='22023'; END IF;
 INSERT INTO ch_web.reward_accounts(user_id,mode) VALUES(p_user,p_mode) ON CONFLICT DO NOTHING;
 SELECT * INTO account FROM ch_web.reward_accounts WHERE user_id=p_user AND mode=p_mode FOR UPDATE;
 SELECT * INTO prior FROM ch_web.reward_ledger WHERE user_id=p_user AND mode=p_mode AND kind='points_conversion' AND reference=p_request;
 IF FOUND THEN
  IF prior.points_delta<>-p_points THEN RAISE EXCEPTION 'Conversion request already used' USING ERRCODE='22023'; END IF;
  RETURN;
 END IF;
 IF account.points_balance<p_points THEN RAISE EXCEPTION 'Not enough Collector Reward Points' USING ERRCODE='22023'; END IF;
 UPDATE ch_web.reward_accounts SET points_balance=points_balance-p_points,credit_cents=credit_cents+p_points,updated_at=now() WHERE user_id=p_user AND mode=p_mode;
 INSERT INTO ch_web.reward_ledger(id,user_id,mode,kind,reference,points_delta,credit_delta) VALUES('convert:'||p_user||':'||p_mode||':'||p_request,p_user,p_mode,'points_conversion',p_request,-p_points,p_points);
END $$;
CREATE FUNCTION ch_web.reserve_store_credit(p_order text,p_user text,p_mode text,p_cents bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE account ch_web.reward_accounts; existing ch_web.credit_reservations;
BEGIN
 IF p_cents=0 THEN RETURN; END IF;
 IF p_cents<0 OR p_mode NOT IN ('live','sandbox') THEN RAISE EXCEPTION 'Invalid credit reservation' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ch_web.commerce_orders WHERE id=p_order AND buyer_user_id=p_user AND sandbox=CASE WHEN p_mode='sandbox' THEN 1 ELSE 0 END AND status='awaiting_payment') THEN RAISE EXCEPTION 'Credit must belong to this unpaid order' USING ERRCODE='22023'; END IF;
 SELECT * INTO account FROM ch_web.reward_accounts WHERE user_id=p_user AND mode=p_mode FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No available store credit' USING ERRCODE='22023'; END IF;
 SELECT * INTO existing FROM ch_web.credit_reservations WHERE order_id=p_order;
 IF FOUND THEN
  IF existing.user_id<>p_user OR existing.mode<>p_mode OR existing.amount_cents<>p_cents OR existing.status<>'reserved' THEN RAISE EXCEPTION 'Credit reservation changed' USING ERRCODE='22023'; END IF;
  RETURN;
 END IF;
 IF account.credit_cents-account.reserved_cents<p_cents THEN RAISE EXCEPTION 'Not enough available store credit' USING ERRCODE='22023'; END IF;
 UPDATE ch_web.reward_accounts SET reserved_cents=reserved_cents+p_cents,updated_at=now() WHERE user_id=p_user AND mode=p_mode;
 INSERT INTO ch_web.credit_reservations(order_id,user_id,mode,amount_cents) VALUES(p_order,p_user,p_mode,p_cents);
END $$;
CREATE FUNCTION ch_web.reconcile_order_rewards(p_order text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o ch_web.commerce_orders; a ch_web.reward_accounts; r ch_web.credit_reservations; earned bigint; reversed bigint; m text; confirmed boolean; refunded boolean;
BEGIN
 SELECT * INTO o FROM ch_web.commerce_orders WHERE id=p_order;
 IF NOT FOUND THEN RETURN; END IF;
 m=CASE WHEN o.sandbox=1 THEN 'sandbox' ELSE 'live' END;
 confirmed=o.payment_intent_id IS NOT NULL AND o.charge_id IS NOT NULL AND EXISTS(SELECT 1 FROM ch_web.commerce_events WHERE order_id=o.id AND type='payment_confirmed' AND provider_event_id IS NOT NULL);
 INSERT INTO ch_web.reward_accounts(user_id,mode) VALUES(o.buyer_user_id,m) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM ch_web.reward_accounts WHERE user_id=o.buyer_user_id AND mode=m FOR UPDATE;
 SELECT * INTO r FROM ch_web.credit_reservations WHERE order_id=o.id FOR UPDATE;
 IF r.order_id IS NOT NULL AND (r.user_id<>o.buyer_user_id OR r.mode<>m OR r.amount_cents<>COALESCE((o.snapshot::jsonb->>'storeCreditCents')::bigint,0)) THEN RAISE EXCEPTION 'Credit reservation requires reconciliation'; END IF;
 IF NOT confirmed THEN
  IF r.status='reserved' AND o.status IN ('checkout_expired','cancelled') THEN
   UPDATE ch_web.reward_accounts SET reserved_cents=reserved_cents-r.amount_cents,updated_at=now() WHERE user_id=o.buyer_user_id AND mode=m;
   UPDATE ch_web.credit_reservations SET status='released',updated_at=now() WHERE order_id=o.id;
  END IF;
  RETURN;
 END IF;
 IF r.status='reserved' THEN
  UPDATE ch_web.reward_accounts SET reserved_cents=reserved_cents-r.amount_cents,credit_cents=credit_cents-r.amount_cents,updated_at=now() WHERE user_id=o.buyer_user_id AND mode=m;
  INSERT INTO ch_web.reward_ledger(id,user_id,mode,kind,reference,order_id,credit_delta) VALUES('credit:spend:'||o.id,o.buyer_user_id,m,'credit_spend',o.id,o.id,-r.amount_cents) ON CONFLICT DO NOTHING;
  UPDATE ch_web.credit_reservations SET status='spent',updated_at=now() WHERE order_id=o.id;
  r.status='spent';
 END IF;
 earned=GREATEST(0,(COALESCE((o.snapshot::jsonb->>'itemAmountCents')::bigint,0)-COALESCE((o.snapshot::jsonb->>'storeCreditCents')::bigint,0))/100);
 IF NOT EXISTS(SELECT 1 FROM ch_web.reward_ledger WHERE user_id=o.buyer_user_id AND mode=m AND kind='purchase_points' AND reference=o.id) THEN
  UPDATE ch_web.reward_accounts SET points_balance=points_balance+earned,updated_at=now() WHERE user_id=o.buyer_user_id AND mode=m;
  INSERT INTO ch_web.reward_ledger(id,user_id,mode,kind,reference,order_id,points_delta) VALUES('points:earn:'||o.id,o.buyer_user_id,m,'purchase_points',o.id,o.id,earned);
 END IF;
 refunded=EXISTS(SELECT 1 FROM ch_web.commerce_money_requests WHERE order_id=o.id AND kind='refund' AND status='succeeded' AND provider_id IS NOT NULL AND amount_cents=(o.snapshot::jsonb->>'totalCents')::bigint);
 IF refunded THEN
  IF r.status='spent' THEN
   UPDATE ch_web.reward_accounts SET credit_cents=credit_cents+r.amount_cents,updated_at=now() WHERE user_id=o.buyer_user_id AND mode=m;
   INSERT INTO ch_web.reward_ledger(id,user_id,mode,kind,reference,order_id,credit_delta) VALUES('credit:restore:'||o.id,o.buyer_user_id,m,'credit_restore',o.id,o.id,r.amount_cents);
   UPDATE ch_web.credit_reservations SET status='restored',updated_at=now() WHERE order_id=o.id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ch_web.reward_ledger WHERE user_id=o.buyer_user_id AND mode=m AND kind='points_reversal' AND reference=o.id) THEN
   SELECT points_delta INTO reversed FROM ch_web.reward_ledger WHERE user_id=o.buyer_user_id AND mode=m AND kind='purchase_points' AND reference=o.id;
   UPDATE ch_web.reward_accounts SET points_balance=points_balance-COALESCE(reversed,0),updated_at=now() WHERE user_id=o.buyer_user_id AND mode=m;
   INSERT INTO ch_web.reward_ledger(id,user_id,mode,kind,reference,order_id,points_delta) VALUES('points:reverse:'||o.id,o.buyer_user_id,m,'points_reversal',o.id,o.id,-COALESCE(reversed,0));
  END IF;
 END IF;
END $$;
COMMENT ON TABLE ch_web.reward_accounts IS 'Non-cashable promotional credit, separated from seller proceeds. Negative points represent refunded rewards already redeemed; new earnings clear the debt.';
