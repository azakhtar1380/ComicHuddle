import { DomainError, once, outbox, serializable } from './db.js';
import { account, post, sellerWallet } from './ledger.js';
import { cents } from './money.js';
export const defaultSafeTrade = { enabled: false, providerApproved: false, thresholdCents: '50000', inclusive: true, shipWithinHours: 48, inspectionWindowHours: 72, minimumDeliveryReviewHours: 48 };
export function requiresSafeTrade(subtotalCents, config = defaultSafeTrade) {
    const price = cents(subtotalCents), threshold = cents(config.thresholdCents);
    return config.inclusive ? price >= threshold : price > threshold;
}
const fullAmount = (o) => cents(o.subtotal_cents) - cents(o.discount_cents) + cents(o.shipping_cents) + cents(o.tax_cents);
async function operationsActor(db, actor) {
    if (actor.kind !== 'user')
        return false;
    const row = (await db.query('SELECT role FROM ch_platform.users WHERE id=$1', [actor.userId])).rows[0];
    return !!row && ['admin', 'vault_operator'].includes(row.role);
}
function requireAt(e, states) { if (!states.includes(e.status))
    throw new DomainError('invalid_transition', 'This event is not valid in the current SafeTrade state.'); }
export async function createSafeTradeForOrder(db, orderId, config) {
    const o = (await db.query('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!o)
        throw new DomainError('order_not_found', 'Order not found.', 404);
    const required = requiresSafeTrade(o.subtotal_cents, config);
    if (required && (!config.enabled || !config.providerApproved))
        throw new DomainError('safetrade_not_ready', 'This high-value order needs SafeTrade, which is not enabled yet.', 503);
    const row = (await db.query(`INSERT INTO ch_platform.escrow_transactions(order_id,threshold_cents,requires_vault) VALUES($1,$2,$3)
  ON CONFLICT(order_id) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING id`, [orderId, config.thresholdCents, required])).rows[0];
    return { required, transactionId: row.id };
}
export async function transitionSafeTrade(pool, transactionId, actor, event, key, config, now = new Date()) {
    if (!config.providerApproved)
        throw new DomainError('payments_disabled', 'Approved payment configuration is required.', 503);
    return serializable(pool, db => once(db, key, 'safetrade_event', { transactionId, actor, event }, async () => {
        const e = (await db.query('SELECT * FROM ch_platform.escrow_transactions WHERE id=$1 FOR UPDATE', [transactionId])).rows[0];
        if (!e)
            throw new DomainError('transaction_not_found', 'Transaction not found.', 404);
        if (e.requires_vault && !config.enabled)
            throw new DomainError('safetrade_disabled', 'SafeTrade is not enabled.', 503);
        const o = (await db.query('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE', [e.order_id])).rows[0];
        const operator = await operationsActor(db, actor);
        let next = e.status;
        const denied = () => { throw new DomainError('forbidden', 'This actor cannot perform this transition.', 403); };
        if (event.type === 'payment_confirmed') {
            if (actor.kind !== 'payment_processor' || !event.receiptVerified)
                denied();
            requireAt(e, ['pending_deposit']);
            if (event.currency !== o.currency || cents(event.amountCents) !== fullAmount(o))
                throw new DomainError('payment_mismatch', 'Payment receipt does not match the immutable order.');
            await db.query(`UPDATE ch_platform.orders SET status='paid',payment_intent_id=$2,charge_id=$3 WHERE id=$1`, [o.id, event.paymentIntentId, event.chargeId]);
            await post(db, { key: 'fund:' + o.id, kind: 'order_funded', orderId: o.id, providerReference: event.chargeId, entries: [
                    { accountId: await account(db, 'provider:clearing', 'provider_clearing'), side: 'debit', amount: fullAmount(o) },
                    { accountId: await account(db, 'order:' + o.id + ':hold', 'order_hold'), side: 'credit', amount: fullAmount(o) }
                ] });
            await db.query('UPDATE ch_platform.escrow_transactions SET seller_ship_by=$2 WHERE id=$1', [e.id, new Date(now.getTime() + config.shipWithinHours * 3600000).toISOString()]);
            next = 'funded';
        }
        else if (event.type === 'seller_dispatched') {
            if (actor.kind !== 'user' || actor.userId !== o.seller_id)
                denied();
            requireAt(e, ['funded']);
            if (!event.acceptanceScanVerified || !event.tracking.trim() || !event.carrier.trim() || now.getTime() > Date.parse(e.seller_ship_by || ''))
                throw new DomainError('shipment_not_accepted', 'A carrier-accepted shipment within the deadline is required.');
            await db.query('UPDATE ch_platform.escrow_transactions SET seller_tracking=$2,seller_carrier=$3 WHERE id=$1', [e.id, event.tracking, event.carrier]);
            next = e.requires_vault ? 'seller_shipped' : 'shipped_to_buyer';
            if (!e.requires_vault)
                await db.query('UPDATE ch_platform.escrow_transactions SET buyer_tracking=$2,buyer_carrier=$3 WHERE id=$1', [e.id, event.tracking, event.carrier]);
        }
        else if (event.type === 'vault_received') {
            if (!operator)
                denied();
            requireAt(e, ['seller_shipped']);
            await db.query('UPDATE ch_platform.escrow_transactions SET inspection_id=$2,received_at_vault_at=$3 WHERE id=$1', [e.id, event.inspectionId, now.toISOString()]);
            next = 'received_at_vault';
        }
        else if (event.type === 'inspection_passed') {
            if (!operator)
                denied();
            requireAt(e, ['received_at_vault']);
            const ids = (await db.query('SELECT collection_item_id FROM ch_platform.order_items WHERE order_id=$1', [o.id])).rows.map(v => v.collection_item_id).sort();
            if (!event.report.editionMatches || !event.report.conditionDisclosed || !event.report.certificatesChecked || !event.report.reportAssetId ||
                ids.length === 0 || ids.join(',') !== [...new Set(event.report.physicalCopyIds)].sort().join(','))
                throw new DomainError('inspection_incomplete', 'Every physical copy and disclosed condition must be inspected.');
            await db.query('UPDATE ch_platform.escrow_transactions SET inspection_passed=true,inspection_report=$2::jsonb,inspected_at=$3 WHERE id=$1', [e.id, JSON.stringify(event.report), now.toISOString()]);
            next = 'inspected';
        }
        else if (event.type === 'inspection_failed') {
            if (!operator)
                denied();
            requireAt(e, ['received_at_vault']);
            next = 'inspection_failed';
            await db.query('UPDATE ch_platform.escrow_transactions SET inspection_passed=false,inspection_report=$2::jsonb,inspected_at=$3 WHERE id=$1', [e.id, JSON.stringify({ reason: event.reason.slice(0, 1000) }), now.toISOString()]);
        }
        else if (event.type === 'vault_dispatched') {
            if (!operator)
                denied();
            requireAt(e, ['inspected']);
            if (!event.tracking.trim() || !event.insuranceReceiptId)
                throw new DomainError('shipment_evidence_missing', 'Vault shipment and insurance receipt are required.');
            await db.query('UPDATE ch_platform.escrow_transactions SET buyer_tracking=$2,buyer_carrier=$3 WHERE id=$1', [e.id, event.tracking, event.carrier]);
            next = 'shipped_to_buyer';
        }
        else if (event.type === 'buyer_delivery_confirmed') {
            if (actor.kind !== 'carrier_webhook')
                denied();
            requireAt(e, ['shipped_to_buyer']);
            const at = Date.parse(event.deliveredAt);
            if (!Number.isFinite(at) || at > now.getTime() || event.tracking !== e.buyer_tracking || !event.destinationMatches || !event.carrierEventId)
                throw new DomainError('delivery_mismatch', 'Verified delivery to the order destination is required.');
            await db.query('UPDATE ch_platform.orders SET confirmed_delivery_at=$2,return_window_ends_at=$3 WHERE id=$1', [o.id, event.deliveredAt, new Date(at + config.minimumDeliveryReviewHours * 3600000).toISOString()]);
            next = 'delivered';
        }
        else if (event.type === 'release_requested') {
            if (actor.kind !== 'release_worker')
                denied();
            requireAt(e, ['delivered']);
            if (o.dispute_open || o.status !== 'paid' || !o.confirmed_delivery_at || !o.return_window_ends_at || Date.parse(o.return_window_ends_at) > now.getTime())
                throw new DomainError('release_not_eligible', 'Delivery review window and dispute checks must pass.');
            const seller = (await db.query('SELECT connected_account_id,payouts_enabled FROM ch_platform.users WHERE id=$1', [o.seller_id])).rows[0];
            if (!seller.connected_account_id || !seller.payouts_enabled || !o.charge_id)
                throw new DomainError('seller_not_ready', 'Seller payout verification is incomplete.');
            const net = cents(o.subtotal_cents) - cents(o.platform_fee_cents);
            if (net > fullAmount(o))
                throw new DomainError('transfer_subsidy_required', 'Seller transfer exceeds charge; funded subsidy support is required.');
            await outbox(db, 'stripe_transfer', e.id, 'release:' + e.id, { orderId: o.id, destination: seller.connected_account_id, amountCents: net.toString(), sourceChargeId: o.charge_id, currency: 'USD' });
            next = 'release_pending';
        }
        else if (event.type === 'release_confirmed') {
            if (actor.kind !== 'payment_processor' || !event.receiptVerified)
                denied();
            requireAt(e, ['release_pending']);
            const seller = (await db.query('SELECT connected_account_id FROM ch_platform.users WHERE id=$1', [o.seller_id])).rows[0];
            const net = cents(o.subtotal_cents) - cents(o.platform_fee_cents);
            if (o.dispute_open || event.sourceChargeId !== o.charge_id || event.destinationAccountId !== seller.connected_account_id || cents(event.amountCents) !== net)
                throw new DomainError('transfer_mismatch', 'Reconcile this transfer before releasing order proceeds.');
            const wallet = await sellerWallet(db, o.seller_id);
            await post(db, { key: 'settle:' + o.id, kind: 'seller_proceeds', walletId: wallet.id, orderId: o.id, providerReference: event.transferId, entries: [
                    { accountId: await account(db, 'order:' + o.id + ':hold', 'order_hold'), side: 'debit', amount: fullAmount(o) },
                    { accountId: wallet.available, side: 'credit', amount: net },
                    { accountId: await account(db, 'platform:revenue', 'platform_revenue'), side: 'credit', amount: cents(o.platform_fee_cents) - cents(o.discount_cents) },
                    { accountId: await account(db, 'platform:tax', 'tax_payable'), side: 'credit', amount: cents(o.tax_cents) },
                    { accountId: await account(db, 'platform:shipping', 'shipping_reserve'), side: 'credit', amount: cents(o.shipping_cents) }
                ] });
            await db.query("UPDATE ch_platform.orders SET status='fulfilled' WHERE id=$1", [o.id]);
            await db.query("UPDATE ch_platform.marketplace_listings SET status='sold',version=version+1 WHERE id=(SELECT listing_id FROM ch_platform.orders WHERE id=$1)", [o.id]);
            await db.query('UPDATE ch_platform.listing_items SET reserved=false WHERE listing_id=(SELECT listing_id FROM ch_platform.orders WHERE id=$1)', [o.id]);
            await db.query("UPDATE ch_platform.collection_items SET status='sold' WHERE id IN (SELECT collection_item_id FROM ch_platform.order_items WHERE order_id=$1)", [o.id]);
            await db.query('UPDATE ch_platform.escrow_transactions SET provider_transfer_id=$2,completed_at=$3 WHERE id=$1', [e.id, event.transferId, now.toISOString()]);
            next = 'completed';
            await outbox(db, 'award_purchase_points', o.id, 'points:order:' + o.id, { orderId: o.id });
        }
        else if (event.type === 'refund_requested') {
            if (actor.kind !== 'release_worker' && !operator && !(actor.kind === 'user' && actor.userId === o.buyer_id))
                denied();
            requireAt(e, ['funded', 'inspection_failed', 'disputed']);
            if (e.provider_transfer_id)
                throw new DomainError('transfer_recovery_required', 'Transferred orders require separate recovery and refund reconciliation.');
            if (event.reason === 'seller_missed_ship_deadline' && (e.status !== 'funded' || !e.seller_ship_by || now.getTime() <= Date.parse(e.seller_ship_by)))
                throw new DomainError('refund_not_eligible', 'Seller shipping deadline has not expired.');
            if (event.reason === 'inspection_failed' && e.status !== 'inspection_failed')
                throw new DomainError('refund_not_eligible', 'Inspection failure is required.');
            if (event.reason === 'approved_return' && !operator)
                denied();
            if (!o.charge_id)
                throw new DomainError('charge_missing', 'Payment must be reconciled.');
            await outbox(db, 'stripe_refund', e.id, 'refund:' + e.id, { orderId: o.id, chargeId: o.charge_id, amountCents: fullAmount(o).toString() });
            await db.query("UPDATE ch_platform.orders SET status='refunding' WHERE id=$1", [o.id]);
            next = 'refund_pending';
        }
        else if (event.type === 'refund_confirmed') {
            if (actor.kind !== 'payment_processor' || !event.receiptVerified)
                denied();
            requireAt(e, ['refund_pending']);
            if (cents(event.amountCents) !== fullAmount(o))
                throw new DomainError('refund_mismatch', 'Refund receipt does not match the order.');
            await post(db, { key: 'refund-ledger:' + o.id, kind: 'buyer_refund', orderId: o.id, providerReference: event.refundId, entries: [
                    { accountId: await account(db, 'order:' + o.id + ':hold', 'order_hold'), side: 'debit', amount: fullAmount(o) },
                    { accountId: await account(db, 'provider:clearing', 'provider_clearing'), side: 'credit', amount: fullAmount(o) }
                ] });
            await db.query("UPDATE ch_platform.orders SET status='refunded' WHERE id=$1", [o.id]);
            // A refund never automatically republishes a physical copy still in transit.
            await db.query("UPDATE ch_platform.marketplace_listings SET status='cancelled',version=version+1 WHERE id=(SELECT listing_id FROM ch_platform.orders WHERE id=$1)", [o.id]);
            await db.query('UPDATE ch_platform.listing_items SET reserved=false WHERE listing_id=(SELECT listing_id FROM ch_platform.orders WHERE id=$1)', [o.id]);
            await db.query("UPDATE ch_platform.return_cases SET status='refunded' WHERE order_id=$1 AND status='refund_pending'", [o.id]);
            await db.query('UPDATE ch_platform.escrow_transactions SET provider_refund_id=$2 WHERE id=$1', [e.id, event.refundId]);
            next = 'refunded';
            await outbox(db, 'reverse_order_rewards', o.id, 'reverse:points:' + o.id, { orderId: o.id });
        }
        else if (event.type === 'dispute_opened') {
            if (actor.kind !== 'payment_processor')
                denied();
            requireAt(e, ['funded', 'seller_shipped', 'received_at_vault', 'inspected', 'shipped_to_buyer', 'delivered', 'release_pending', 'completed']);
            await db.query("UPDATE ch_platform.orders SET dispute_open=true,status='disputed' WHERE id=$1", [o.id]);
            next = 'disputed';
            await outbox(db, 'reconcile_dispute', e.id, 'dispute:' + event.providerDisputeId, { orderId: o.id, disputeId: event.providerDisputeId });
        }
        await db.query('UPDATE ch_platform.escrow_transactions SET status=$2,version=version+1 WHERE id=$1', [e.id, next]);
        await db.query(`INSERT INTO ch_platform.escrow_events(transaction_id,event,from_status,to_status,actor_user_id,evidence,idempotency_key)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [e.id, event.type, e.status, next, actor.kind === 'user' ? actor.userId : null, JSON.stringify(event), key]);
        return { transactionId: e.id, status: next };
    }));
}
