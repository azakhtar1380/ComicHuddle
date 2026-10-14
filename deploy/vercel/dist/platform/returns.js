import { DomainError, once, outbox, serializable } from './db.js';
import { account, balance, post, sellerWallet } from './ledger.js';
import { cents } from './money.js';
// Called after the return has physically arrived and passed inspection. Refunds
// after transfer require separate transfer reversal, not just a Charge refund.
export async function approveInspectedReturn(pool, operatorId, orderId, inspectionAssetId, key) {
    return serializable(pool, db => once(db, key, 'approve_return', { operatorId, orderId, inspectionAssetId }, async () => {
        const op = (await db.query('SELECT role FROM ch_platform.users WHERE id=$1', [operatorId])).rows[0];
        if (!op || !['admin', 'vault_operator'].includes(op.role))
            throw new DomainError('forbidden', 'Authorized return inspection is required.', 403);
        const order = (await db.query('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        const escrow = (await db.query('SELECT * FROM ch_platform.escrow_transactions WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!order || !['fulfilled', 'disputed'].includes(order.status) || !escrow?.provider_transfer_id || !inspectionAssetId)
            throw new DomainError('return_not_eligible', 'Transferred order and recorded return inspection are required.');
        const net = cents(order.subtotal_cents) - cents(order.platform_fee_cents), wallet = await sellerWallet(db, order.seller_id);
        if (await balance(db, wallet.available) < net)
            throw new DomainError('funded_recovery_required', 'Seller proceeds have been withdrawn. An operator must fund and reconcile the refund reserve before proceeding.');
        const row = (await db.query(`INSERT INTO ch_platform.return_cases(order_id,status,inspection_asset_id,approved_by,recovery_cents,provider_transfer_id)
   VALUES($1,'recovery_reserved',$2,$3,$4,$5) RETURNING id`, [orderId, inspectionAssetId, operatorId, net.toString(), escrow.provider_transfer_id])).rows[0];
        await post(db, { key: 'return-reserve:' + row.id, kind: 'return_recovery_reserved', walletId: wallet.id, orderId, entries: [{ accountId: wallet.available, side: 'debit', amount: net }, { accountId: wallet.reserved, side: 'credit', amount: net }] });
        await db.query("UPDATE ch_platform.orders SET status='refunding' WHERE id=$1", [orderId]);
        await outbox(db, 'stripe_transfer_reversal', row.id, 'return-reversal:' + row.id, { returnId: row.id, orderId, transferId: escrow.provider_transfer_id, amountCents: net.toString() });
        return { returnId: row.id, status: 'recovery_reserved' };
    }));
}
export async function confirmReturnRecovery(pool, returnId, receipt, key) {
    return serializable(pool, db => once(db, key, 'return_recovered', { returnId, receipt }, async () => {
        const r = (await db.query('SELECT * FROM ch_platform.return_cases WHERE id=$1 FOR UPDATE', [returnId])).rows[0];
        if (!r || r.status !== 'recovery_reserved' || !receipt.receiptVerified || receipt.transferId !== r.provider_transfer_id || cents(receipt.amountCents) !== cents(r.recovery_cents))
            throw new DomainError('return_receipt_mismatch', 'Reconcile the transfer reversal before issuing a refund.');
        const o = (await db.query('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE', [r.order_id])).rows[0];
        const escrow = (await db.query('SELECT id,status FROM ch_platform.escrow_transactions WHERE order_id=$1 FOR UPDATE', [r.order_id])).rows[0];
        const wallet = await sellerWallet(db, o.seller_id), full = cents(o.subtotal_cents) - cents(o.discount_cents) + cents(o.shipping_cents) + cents(o.tax_cents);
        await post(db, { key: 'return-recovered:' + returnId, kind: 'settlement_reversed', walletId: wallet.id, orderId: r.order_id, providerReference: receipt.reversalId, entries: [
                { accountId: wallet.reserved, side: 'debit', amount: cents(r.recovery_cents) },
                { accountId: await account(db, 'platform:revenue', 'platform_revenue'), side: 'debit', amount: cents(o.platform_fee_cents) - cents(o.discount_cents) },
                { accountId: await account(db, 'platform:shipping', 'shipping_reserve'), side: 'debit', amount: cents(o.shipping_cents) },
                { accountId: await account(db, 'platform:tax', 'tax_payable'), side: 'debit', amount: cents(o.tax_cents) },
                { accountId: await account(db, 'order:' + r.order_id + ':hold', 'order_hold'), side: 'credit', amount: full }
            ] });
        await db.query("UPDATE ch_platform.return_cases SET status='refund_pending',provider_reversal_id=$2 WHERE id=$1", [returnId, receipt.reversalId]);
        await db.query("UPDATE ch_platform.escrow_transactions SET status='refund_pending',version=version+1 WHERE id=$1", [escrow.id]);
        await db.query(`INSERT INTO ch_platform.escrow_events(transaction_id,event,from_status,to_status,evidence,idempotency_key) VALUES($1,'return_recovered',$2,'refund_pending',$3::jsonb,$4)`, [escrow.id, escrow.status, JSON.stringify(receipt), key]);
        await outbox(db, 'stripe_refund', escrow.id, 'return-refund:' + returnId, { orderId: r.order_id, chargeId: o.charge_id, amountCents: full.toString() });
        return { returnId, status: 'refund_pending' };
    }));
}
