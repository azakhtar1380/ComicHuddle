import { z } from 'zod';
import { DomainError, serializable } from './db.js';
import { claimJob, executeOutboxJob } from './providers.js';
import { confirmReturnRecovery } from './returns.js';
import { transitionSafeTrade } from './escrow.js';
import { settleWithdrawal } from './wallet.js';
import { awardPurchasePoints, reverseOrderRewards } from './rewards.js';
export function paymentWorker(pool, stripe, config) {
    const handler = async (job) => {
        const p = job.payload;
        if (job.kind === 'stripe_payment_intent') {
            const result = await stripe.createPayment({ orderId: p.orderId, amountCents: p.amountCents, key: job.operation_key });
            // The client secret is returned only by an authenticated order payment route,
            // never written to logs, ledger, outbox payload, or operation result.
            await serializable(pool, async (db) => { const r = await db.query("UPDATE ch_platform.orders SET payment_intent_id=$2 WHERE id=$1 AND status='payment_preparing' AND(payment_intent_id IS NULL OR payment_intent_id=$2) RETURNING id", [p.orderId, result.id]); if (!r.rows.length)
                throw new DomainError('payment_reconcile_required', 'Order changed while preparing payment.'); });
        }
        else if (job.kind === 'stripe_transfer') {
            const db = await pool.connect();
            try {
                const row = (await db.query('SELECT * FROM ch_platform.orders WHERE id=$1', [p.orderId])).rows[0];
                if (!row || row.dispute_open || row.status !== 'paid' || row.charge_id !== p.sourceChargeId)
                    throw new DomainError('release_no_longer_eligible', 'A dispute or changed payment prevents release.');
            }
            finally {
                db.release();
            }
            const result = await stripe.transfer({ destination: p.destination, amountCents: p.amountCents, sourceChargeId: p.sourceChargeId, orderId: p.orderId, key: job.operation_key });
            await transitionSafeTrade(pool, job.aggregate_id, { kind: 'payment_processor' }, { type: 'release_confirmed', transferId: result.id, destinationAccountId: result.destination, amountCents: String(result.amount), sourceChargeId: result.source_transaction, receiptVerified: true }, 'transfer-receipt:' + result.id, config.safetrade);
        }
        else if (job.kind === 'stripe_transfer_reversal') {
            const result = z.object({ id: z.string(), amount: z.number().int(), transfer: z.string() }).parse(await stripe.reverseTransfer({ transferId: p.transferId, amountCents: p.amountCents, orderId: p.orderId, key: job.operation_key }));
            await confirmReturnRecovery(pool, job.aggregate_id, { transferId: result.transfer, reversalId: result.id, amountCents: String(result.amount), receiptVerified: true }, 'reversal-receipt:' + result.id);
        }
        else if (job.kind === 'stripe_refund') {
            const result = await stripe.refund({ chargeId: p.chargeId, amountCents: p.amountCents, orderId: p.orderId, key: job.operation_key });
            // pending refunds are reconciled via refund.updated, not marked successful.
            if (result.status !== 'succeeded' || result.charge !== p.chargeId)
                throw new DomainError('provider_outcome_unknown', 'Refund must be reconciled before local completion.');
            await transitionSafeTrade(pool, job.aggregate_id, { kind: 'payment_processor' }, { type: 'refund_confirmed', refundId: result.id, amountCents: String(result.amount), receiptVerified: true }, 'refund-receipt:' + result.id, config.safetrade);
        }
        else if (job.kind === 'stripe_payout') {
            const db = await pool.connect();
            try {
                const dispute = (await db.query("SELECT id FROM ch_platform.orders WHERE seller_id=$1 AND dispute_open LIMIT 1", [p.userId])).rows[0];
                if (dispute)
                    throw new DomainError('payout_blocked_by_dispute', 'Resolve outstanding disputes before bank payout.');
            }
            finally {
                db.release();
            }
            const result = await stripe.payout({ accountId: p.destination, amountCents: p.amountCents, withdrawalId: job.aggregate_id, key: job.operation_key });
            await serializable(pool, async (db) => { const r = await db.query("UPDATE ch_platform.withdrawals SET provider_payout_id=$2,status='submitted',updated_at=now() WHERE id=$1 AND status='reserved' AND(provider_payout_id IS NULL OR provider_payout_id=$2) RETURNING id", [job.aggregate_id, result.id]); if (!r.rows.length)
                throw new DomainError('payout_reconcile_required', 'Payout outcome must be reconciled.'); });
        }
        else if (job.kind === 'award_purchase_points')
            await awardPurchasePoints(pool, p.orderId, config.rewards);
        else if (job.kind === 'reverse_order_rewards')
            await reverseOrderRewards(pool, p.orderId, config.rewards);
        else if (job.kind === 'reconcile_stripe_event')
            await reconcileStripeEvent(pool, stripe, p.provider, p.eventId, config.safetrade);
        else
            throw new DomainError('worker_kind_unsupported', 'This job requires a reviewed operator handler.');
    };
    return { async runOne(workerId) { const job = await claimJob(pool, workerId, ['stripe_payment_intent', 'stripe_transfer', 'stripe_transfer_reversal', 'stripe_refund', 'stripe_payout', 'award_purchase_points', 'reverse_order_rewards', 'reconcile_stripe_event']); if (!job)
            return false; await executeOutboxJob(pool, job, handler); return true; } };
}
export async function reconcileStripeEvent(pool, stripe, provider, eventId, config) {
    if (provider !== 'stripe')
        throw new DomainError('event_provider_invalid', 'Unsupported event provider.');
    const db = await pool.connect();
    let event;
    try {
        event = (await db.query('SELECT * FROM ch_platform.provider_events WHERE provider=$1 AND event_id=$2', [provider, eventId])).rows[0];
    }
    finally {
        db.release();
    }
    if (!event)
        throw new DomainError('event_missing', 'Saved verified event is required.');
    if (event.event_type === 'payment_intent.succeeded') {
        const pi = z.object({ id: z.string(), status: z.string(), amount_received: z.number().int(), currency: z.string(), latest_charge: z.string(), metadata: z.object({ order_id: z.string().uuid() }) }).parse(await stripe.retrieveObject('/v1/payment_intents/' + event.object_id));
        if (pi.status !== 'succeeded' || pi.currency !== 'usd')
            throw new DomainError('payment_not_confirmed', 'Current payment state is not successful.');
        const c = await pool.connect();
        let transaction;
        try {
            transaction = (await c.query(`SELECT e.id,o.payment_intent_id FROM ch_platform.escrow_transactions e JOIN ch_platform.orders o ON o.id=e.order_id WHERE o.id=$1`, [pi.metadata.order_id])).rows[0];
        }
        finally {
            c.release();
        }
        if (!transaction || transaction.payment_intent_id !== pi.id)
            throw new DomainError('payment_link_mismatch', 'Payment does not match the saved order intent.');
        await transitionSafeTrade(pool, transaction.id, { kind: 'payment_processor' }, { type: 'payment_confirmed', paymentIntentId: pi.id, chargeId: pi.latest_charge, amountCents: String(pi.amount_received), currency: 'USD', receiptVerified: true }, 'payment-receipt:' + pi.id, config);
    }
    else if (event.event_type === 'charge.dispute.created') {
        const dispute = z.object({ id: z.string(), charge: z.string(), status: z.string() }).parse(await stripe.retrieveObject('/v1/disputes/' + event.object_id));
        const c = await pool.connect();
        let row;
        try {
            row = (await c.query('SELECT e.id FROM ch_platform.escrow_transactions e JOIN ch_platform.orders o ON o.id=e.order_id WHERE o.charge_id=$1', [dispute.charge])).rows[0];
        }
        finally {
            c.release();
        }
        if (!row)
            throw new DomainError('operator_reconciliation_required', 'Unmapped disputed charge needs review.');
        await transitionSafeTrade(pool, row.id, { kind: 'payment_processor' }, { type: 'dispute_opened', providerDisputeId: dispute.id }, 'dispute-receipt:' + dispute.id, config);
    }
    else if (event.event_type === 'refund.updated' || event.event_type === 'refund.created') {
        const refund = z.object({ id: z.string(), status: z.string().nullable(), charge: z.string(), currency: z.string(), amount: z.number().int(), metadata: z.object({ order_id: z.string().uuid() }) }).parse(await stripe.retrieveObject('/v1/refunds/' + event.object_id));
        if (refund.status !== 'succeeded' || refund.currency !== 'usd')
            throw new DomainError('operator_reconciliation_required', 'Refund is not confirmed successful.');
        const c = await pool.connect();
        let row;
        try {
            row = (await c.query('SELECT e.id,o.charge_id FROM ch_platform.escrow_transactions e JOIN ch_platform.orders o ON o.id=e.order_id WHERE o.id=$1', [refund.metadata.order_id])).rows[0];
        }
        finally {
            c.release();
        }
        if (!row || row.charge_id !== refund.charge)
            throw new DomainError('operator_reconciliation_required', 'Refund charge does not match the saved order.');
        await transitionSafeTrade(pool, row.id, { kind: 'payment_processor' }, { type: 'refund_confirmed', refundId: refund.id, amountCents: String(refund.amount), receiptVerified: true }, 'refund-receipt:' + refund.id, config);
    }
    else if (event.event_type === 'payout.paid' || event.event_type === 'payout.failed') {
        const c = await pool.connect();
        let row;
        try {
            row = (await c.query('SELECT w.id,u.connected_account_id FROM ch_platform.withdrawals w JOIN ch_platform.users u ON u.id=w.user_id WHERE w.provider_payout_id=$1', [event.object_id])).rows[0];
        }
        finally {
            c.release();
        }
        if (!row)
            throw new DomainError('payout_missing', 'Payout needs operator reconciliation.');
        const po = z.object({ id: z.string(), status: z.string(), amount: z.number().int() }).parse(await stripe.retrieveObject('/v1/payouts/' + event.object_id, row.connected_account_id));
        if (!['paid', 'failed'].includes(po.status))
            throw new DomainError('payout_pending', 'Payout is not terminal.');
        await settleWithdrawal(pool, row.id, { payoutId: po.id, connectedAccountId: row.connected_account_id, amountCents: String(po.amount), status: po.status, receiptVerified: true }, 'payout-receipt:' + po.id + ':' + po.status);
    }
    else {
        // Disputes, async refunds, transfer reversals, chargebacks and disputes.closed
        // must route to the operator reconciliation queue; they never disappear.
        throw new DomainError('operator_reconciliation_required', 'This event needs its configured dispute/refund handler.');
    }
    await serializable(pool, c => c.query("UPDATE ch_platform.provider_events SET status='processed' WHERE provider=$1 AND event_id=$2", [provider, eventId]));
}
