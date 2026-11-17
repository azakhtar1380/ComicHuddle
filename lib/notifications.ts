// In-app notifications (migration 036). Server-only. notify() never throws: a failed notification must
// not undo or block the action that caused it. Recipients are account user ids (profiles.user_id).
import {getPool} from '../db/postgres';

export type NotificationKind = 'offer' | 'offer_reply' | 'trade' | 'order' | 'safepurchase' | 'tracking' | 'payout' | 'pickup' | 'verification' | 'system' | 'achievement';
export type NotificationInput = {userId: string; kind: NotificationKind; title: string; body?: string; href?: string};
export type NotificationRow = {id: string; kind: NotificationKind; title: string; body: string; href: string; createdAt: string; read: boolean};

const clip = (value: string, max: number) => value.length > max ? value.slice(0, max - 1) + '…' : value;
const safeHref = (href = '') => href.startsWith('/') && !href.startsWith('//') ? clip(href, 500) : '';

export async function notify(input: NotificationInput | NotificationInput[]) {
  const list = (Array.isArray(input) ? input : [input]).filter(n => n.userId && n.title);
  if (!list.length) return;
  try {
    const values: unknown[] = [], rows: string[] = [];
    list.forEach((n, i) => {
      rows.push(`($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`);
      values.push(crypto.randomUUID(), n.userId, n.kind, clip(n.title, 140), clip(n.body || '', 400), safeHref(n.href));
    });
    await getPool().query(`INSERT INTO ch_web.notifications (id,user_id,kind,title,body,href) VALUES ${rows.join(',')}`, values);
  } catch { /* table not migrated yet, or a transient error: the main action still succeeds */ }
}

/** user_id for a profile id, for callers that only know profiles. */
export async function userIdForProfile(profileId: string): Promise<string | null> {
  try { const r = await getPool().query<{user_id: string}>('SELECT user_id FROM ch_web.profiles WHERE id=$1', [profileId]); return r.rows[0]?.user_id || null; } catch { return null; }
}

export async function listNotifications(userId: string, limit = 30): Promise<{items: NotificationRow[]; unread: number}> {
  try {
    const pool = getPool();
    const [rows, count] = await Promise.all([
      pool.query<{id: string; kind: NotificationKind; title: string; body: string; href: string; created_at: Date; read_at: Date | null}>('SELECT id,kind,title,body,href,created_at,read_at FROM ch_web.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [userId, Math.min(Math.max(limit, 1), 100)]),
      pool.query<{n: string}>('SELECT count(*) AS n FROM ch_web.notifications WHERE user_id=$1 AND read_at IS NULL', [userId]),
    ]);
    return {items: rows.rows.map(r => ({id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: new Date(r.created_at).toISOString(), read: !!r.read_at})), unread: Number(count.rows[0]?.n || 0)};
  } catch { return {items: [], unread: 0}; }
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  try {
    if (ids?.length) await getPool().query('UPDATE ch_web.notifications SET read_at=now() WHERE user_id=$1 AND id=ANY($2::text[]) AND read_at IS NULL', [userId, ids.slice(0, 200)]);
    else await getPool().query('UPDATE ch_web.notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [userId]);
  } catch { /* ignore */ }
}

/** Fixed id for the payment-setup reminder. It is computed on every read, never stored, so it stays
 * until the seller finishes Stripe onboarding (marking it read has no lasting effect). */
export const PAYOUT_SETUP_REMINDER_ID = '00000000-0000-4000-8000-00000000c0de';
/** Sellers (anyone with a listing) whose payment onboarding isn't finished get a pinned reminder. */
export async function payoutSetupReminder(userId: string): Promise<NotificationRow | null> {
  try {
    const result = await getPool().query<{listed: boolean; ready: boolean}>(
      `SELECT EXISTS(SELECT 1 FROM ch_web.listings l JOIN ch_web.profiles p ON p.id=l.seller_id WHERE p.user_id=$1 AND l.status IN ('active','ended','sold','auction_won')) AS listed,
       COALESCE((SELECT (s.state::jsonb->>'ready')='true' FROM ch_web.commerce_sellers s WHERE s.user_id=$1),false) AS ready`, [userId]);
    const row = result.rows[0];
    if (!row?.listed || row.ready) return null;
    return {id: PAYOUT_SETUP_REMINDER_ID, kind: 'payout', title: 'Set up payment onboarding', body: 'Finish your Stripe setup so buyers can pay you and your money reaches your bank.', href: '/?section=Orders', createdAt: new Date().toISOString(), read: false};
  } catch { return null; }
}
