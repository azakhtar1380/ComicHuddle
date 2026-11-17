// Admin records (server-only, migration 040): the admin action audit log, plus admin/founder lookups by
// account id for code that only knows a user id or a profile id. Admin identity itself stays in lib/admin.ts
// (owner-written): admins are recognized by account email, the site owner is always the Founder.
// Public display gets booleans only. Emails never leave this module.
import {getPool} from '../db/postgres';
import {adminEmails,founderEmail,isAdmin,isFounder} from './admin';
import {ownerAccountId} from './owner';

export type AdminAuditEntry = {id: string; adminUserId: string; adminName: string | null; founder: boolean; action: string; targetType: string; targetId: string; detail: Record<string, unknown>; createdAt: string};
export type AuditInput = {admin: {userId: string; email?: string | null}; action: string; targetType?: string; targetId?: string; detail?: Record<string, unknown>};

const missingTable = (error: unknown) => (error as {code?: string})?.code === '42P01';
const clip = (value: string, max: number) => value.length > max ? value.slice(0, max) : value;

/** The account email for a user id, or null. Only used inside this module. */
async function accountEmail(userId: string): Promise<string | null> {
  try {
    const result = await getPool().query<{email: string}>('SELECT email FROM ch_web."user" WHERE id=$1', [userId]);
    return result.rows[0]?.email || null;
  } catch { return null; }
}

/** True when this account id is an admin (owner, or an account whose email is in COMICHUDDLE_ADMIN_EMAILS). */
export async function isAdminUserId(userId: string): Promise<boolean> {
  if (!userId) return false;
  if (userId === ownerAccountId) return true;
  if (!adminEmails().length && !founderEmail()) return false;
  return isAdmin({userId, email: await accountEmail(userId)});
}

export type StaffBadge = {admin: boolean; founder: boolean};
/** Public-safe badge flags for one account id. Never returns the email. */
export async function staffBadgeForUser(userId: string | null | undefined): Promise<StaffBadge> {
  if (!userId) return {admin: false, founder: false};
  const email = adminEmails().length || founderEmail() ? await accountEmail(userId) : null;
  const founder = isFounder({userId, email});
  return {admin: founder || isAdmin({userId, email}), founder};
}

/** Public-safe badge flags keyed by profile id (profiles without a badge are omitted). */
export async function staffBadgesForProfiles(profileIds: string[]): Promise<Record<string, StaffBadge>> {
  const ids = [...new Set(profileIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 100))].slice(0, 500);
  if (!ids.length) return {};
  const emails = adminEmails(), out: Record<string, StaffBadge> = {};
  try {
    const result = await getPool().query<{id: string; user_id: string; email: string | null}>(
      'SELECT p.id, p.user_id, u.email FROM ch_web.profiles p LEFT JOIN ch_web."user" u ON u.id = p.user_id WHERE p.id = ANY($1::text[])', [ids]);
    for (const row of result.rows) {
      const founder = isFounder({userId: row.user_id, email: row.email});
      const admin = founder || (!!emails.length && isAdmin({userId: row.user_id, email: row.email}));
      if (admin) out[row.id] = {admin, founder};
    }
  } catch { /* lookups are display-only: no badge rather than an error */ }
  return out;
}

/** Records one admin action. Returns false when the audit table is not migrated yet (the caller decides). */
export async function logAdminAction(input: AuditInput): Promise<boolean> {
  try {
    await getPool().query('INSERT INTO ch_web.admin_audit_log (id,admin_user_id,founder,action,target_type,target_id,detail) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [
      crypto.randomUUID(), input.admin.userId, isFounder(input.admin), clip(input.action, 80), clip(input.targetType || '', 40), clip(input.targetId || '', 100), JSON.stringify(input.detail || {}).slice(0, 8000)]);
    return true;
  } catch (error) {
    if (!missingTable(error)) console.warn('Admin audit entry could not be written.');
    return false;
  }
}

/** True when migration 040 is applied (audit table present). Admin writes require it. */
export async function adminAuditReady(): Promise<boolean> {
  try { await getPool().query('SELECT 1 FROM ch_web.admin_audit_log LIMIT 1'); return true; } catch { return false; }
}

export async function listAdminAudit(options: {targetType?: string; targetId?: string; limit?: number; offset?: number} = {}): Promise<{ready: boolean; entries: AdminAuditEntry[]; hasMore: boolean}> {
  const limit = Math.min(Math.max(options.limit || 50, 1), 200), offset = Math.min(Math.max(options.offset || 0, 0), 100000);
  const where: string[] = [], values: unknown[] = [];
  if (options.targetType) { values.push(options.targetType); where.push(`a.target_type=$${values.length}`); }
  if (options.targetId) { values.push(options.targetId); where.push(`a.target_id=$${values.length}`); }
  values.push(limit + 1, offset);
  try {
    const result = await getPool().query<{id: string; admin_user_id: string; founder: boolean; action: string; target_type: string; target_id: string; detail: Record<string, unknown> | null; created_at: Date; name: string | null}>(
      `SELECT a.id,a.admin_user_id,a.founder,a.action,a.target_type,a.target_id,a.detail,a.created_at,
        (SELECT p.name FROM ch_web.profiles p WHERE p.user_id=a.admin_user_id LIMIT 1) AS name
       FROM ch_web.admin_audit_log a ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const rows = result.rows.slice(0, limit);
    return {ready: true, hasMore: result.rows.length > limit, entries: rows.map(row => ({id: row.id, adminUserId: row.admin_user_id, adminName: row.name, founder: row.founder, action: row.action, targetType: row.target_type, targetId: row.target_id, detail: row.detail || {}, createdAt: new Date(row.created_at).toISOString()}))};
  } catch (error) {
    if (!missingTable(error)) throw error;
    return {ready: false, entries: [], hasMore: false};
  }
}
