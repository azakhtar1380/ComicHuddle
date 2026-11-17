// Admins are ordinary signed-in accounts whose email is listed in the private server setting
// COMICHUDDLE_ADMIN_EMAILS (comma-separated, case-insensitive). There is no separate admin login.
// COMICHUDDLE_ADMIN_LIMIT caps how many listed emails count (default 3), so the team can grow later.
// The Founder is the site owner account (ownerAccountId) or the account whose email matches the private setting
// COMICHUDDLE_FOUNDER_EMAIL (one email, case-insensitive). The Founder is always an admin and is shown with the
// "Founder" label only. The email never leaves the server: clients only ever get a founder:true flag.
// Server-only: never import this from a client component.
import {ownerAccountId} from './owner';

export const DEFAULT_ADMIN_LIMIT = 3;

export function adminLimit(env: Record<string, string | undefined> = process.env) {
  const n = Number(env.COMICHUDDLE_ADMIN_LIMIT);
  return Number.isInteger(n) && n > 0 && n <= 50 ? n : DEFAULT_ADMIN_LIMIT;
}

/** The first `adminLimit()` distinct, well-formed emails from COMICHUDDLE_ADMIN_EMAILS. Empty when unset. */
export function adminEmails(env: Record<string, string | undefined> = process.env): string[] {
  const list = String(env.COMICHUDDLE_ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  return [...new Set(list)].slice(0, adminLimit(env));
}

export type AdminIdentity = {userId: string; email?: string | null};
/** COMICHUDDLE_FOUNDER_EMAIL, trimmed and lowercased, or '' when unset or malformed. */
export function founderEmail(env: Record<string, string | undefined> = process.env) {
  const email = String(env.COMICHUDDLE_FOUNDER_EMAIL || '').trim().toLowerCase();
  return /^[^s@,]+@[^s@,]+.[^s@,]+$/.test(email) ? email : '';
}
export function isFounder(user: AdminIdentity | null | undefined, env: Record<string, string | undefined> = process.env) {
  if (!user) return false;
  if (user.userId === ownerAccountId) return true;
  const founder = founderEmail(env), email = (user.email || '').trim().toLowerCase();
  return !!founder && !!email && email === founder;
}
export function isAdmin(user: AdminIdentity | null | undefined, env: Record<string, string | undefined> = process.env) {
  if (!user) return false;
  if (isFounder(user, env)) return true;
  const email = (user.email || '').trim().toLowerCase();
  return !!email && adminEmails(env).includes(email);
}

export class AdminRequiredError extends Error { status = 403; constructor() { super('Admin access required.'); } }
/** Throw unless the signed-in user is an admin. Every admin route and API action must call this. */
export function requireAdmin<T extends AdminIdentity>(user: T | null | undefined): T {
  if (!user || !isAdmin(user)) throw new AdminRequiredError();
  return user;
}
