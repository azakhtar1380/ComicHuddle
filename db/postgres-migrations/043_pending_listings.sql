-- Additive only. A listing paid through checkout is 'pending' (off the market, not yet sold) until its
-- order finishes: delivered (shipping) or picked up (local pickup, confirmed by the seller). Then it is
-- 'sold'. If a paid order is refunded or cancelled instead, the listing is taken down ('withdrawn') so the
-- seller can relist it. A trigger keeps this in one place, whatever code path updates the order.
CREATE OR REPLACE FUNCTION ch_web.settle_pending_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('delivered_review','picked_up','release_eligible','transfer_pending','transferred') THEN
    UPDATE ch_web.listings SET status = 'sold' WHERE id = NEW.listing_id AND status = 'pending';
  ELSIF NEW.status IN ('refunded','cancelled') THEN
    UPDATE ch_web.listings SET status = 'withdrawn' WHERE id = NEW.listing_id AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS commerce_order_settles_listing ON ch_web.commerce_orders;
CREATE TRIGGER commerce_order_settles_listing
  AFTER UPDATE OF status ON ch_web.commerce_orders
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION ch_web.settle_pending_listing();

-- Orders already paid but not finished: move their listings from 'sold' to 'pending' so they settle the same way.
UPDATE ch_web.listings l SET status = 'pending'
 WHERE l.status = 'sold' AND EXISTS (SELECT 1 FROM ch_web.commerce_orders o WHERE o.listing_id = l.id
   AND o.status IN ('awaiting_shipment','in_transit','awaiting_pickup','shipped_to_inspection','at_inspection','inspection_passed','shipped_to_buyer','manual_review','refund_eligible','inspection_failed'));
