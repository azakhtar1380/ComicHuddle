// Personal (collector) or business (comic shop / dealer) profiles and the verified-business tick
// (migration 041: ch_web.business_profiles + ch_web.business_verification_events). Server-only.
// Every read is tolerant: if the tables are missing (database not migrated yet) everyone is a collector
// and nobody is verified. Writes report `BusinessStorageMissingError` so the API can say so plainly.
//
// Client components may `import type` from here (types are erased); never import values client-side.
import {z} from 'zod';
import {getPool} from '../db/postgres';

export type AccountType = 'collector' | 'business';
export type BusinessKind = 'shop' | 'dealer';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'revoked';

/** Public business facts shown on profiles, listings and messages. Only present for business accounts. */
export type PublicBusiness = {
  kind: BusinessKind; shopName: string; logoUrl: string | null; city: string; state: string;
  website: string; shippingPolicy: string; returnsPolicy: string;
};
/** Fields appended to public profile data (profileDto) and seller/peer data. */
export type BusinessSummary = {isBusiness: boolean; verified: boolean; shopName: string | null; business?: PublicBusiness};
/** The owner's own record, including verification state. */
export type OwnBusiness = PublicBusiness & {
  accountType: AccountType; logoId: string | null; verificationStatus: VerificationStatus;
  verificationSource: string | null; verifiedAt: string | null; updatedAt: string | null;
};
export type AdminBusinessRow = OwnBusiness & {
  profileId: string; handle: string; name: string; verifiedBy: string | null; verificationNote: string;
  statusChangedAt: string | null; events: {action: string; status: string; source: string; actorUserId: string | null; note: string; createdAt: string}[];
};

export const COLLECTOR: BusinessSummary = {isBusiness: false, verified: false, shopName: null};
export const businessLogoUrl = (mediaId: string | null | undefined) => mediaId ? '/api/business?logo=' + encodeURIComponent(mediaId) : null;

export class BusinessStorageMissingError extends Error {
  status = 503;
  constructor() { super('Business profiles are not switched on yet. The site owner needs to apply database update 041.'); }
}
const missingTable = (error: unknown) => !!error && typeof error === 'object' && (error as {code?: string}).code === '42P01';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** https?:// URL with a real host. Returns the normalized URL, or '' for blank. Throws on anything else. */
export function normalizeWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
  const url = new URL(withScheme);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error('website');
  return url.toString().slice(0, 200);
}

const line = (max: number) => z.string().trim().max(max).transform(v => v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim());
const block = (max: number) => z.string().max(max).transform(v => v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim());

export const businessInputSchema = z.object({
  accountType: z.enum(['collector', 'business']),
  kind: z.enum(['shop', 'dealer']).default('shop'),
  shopName: line(80).default(''),
  logoId: z.string().regex(uuid).nullable().default(null),
  city: line(60).default(''),
  state: z.string().trim().toUpperCase().default(''),
  website: z.string().max(200).default(''),
  shippingPolicy: block(1000).default(''),
  returnsPolicy: block(1000).default(''),
}).superRefine((v, ctx) => {
  if (v.accountType !== 'business') return;
  if (v.shopName.length < 2) ctx.addIssue({code: 'custom', path: ['shopName'], message: 'Add your shop name.'});
  if (v.city.length < 2) ctx.addIssue({code: 'custom', path: ['city'], message: 'Add the city your shop is in.'});
  if (!(US_STATES as readonly string[]).includes(v.state)) ctx.addIssue({code: 'custom', path: ['state'], message: 'Pick the state your shop is in.'});
  try { normalizeWebsite(v.website); } catch { ctx.addIssue({code: 'custom', path: ['website'], message: 'Enter a website like https://myshop.com, or leave it blank.'}); }
});
export type BusinessInput = z.infer<typeof businessInputSchema>;

type Row = {
  profile_id: string; user_id: string; account_type: AccountType; business_kind: BusinessKind; shop_name: string; logo_media_id: string | null;
  city: string; state: string; website: string; shipping_policy: string; returns_policy: string; verification_status: VerificationStatus;
  verification_source: string | null; verification_ref: string | null; verification_note: string; verified_at: Date | null; verified_by: string | null;
  status_changed_at: Date | null; status_changed_by: string | null; updated_at: Date | null;
};
const iso = (value: Date | null) => value ? new Date(value).toISOString() : null;
const publicOf = (r: Row): PublicBusiness => ({kind: r.business_kind, shopName: r.shop_name, logoUrl: businessLogoUrl(r.logo_media_id), city: r.city, state: r.state, website: r.website, shippingPolicy: r.shipping_policy, returnsPolicy: r.returns_policy});
const summaryOf = (r: Row | undefined): BusinessSummary => !r || r.account_type !== 'business' ? COLLECTOR
  : {isBusiness: true, verified: r.verification_status === 'verified', shopName: r.shop_name || null, business: publicOf(r)};
const ownOf = (r: Row): OwnBusiness => ({...publicOf(r), accountType: r.account_type, logoId: r.logo_media_id, verificationStatus: r.verification_status, verificationSource: r.verification_source, verifiedAt: iso(r.verified_at), updatedAt: iso(r.updated_at)});

/** profileId → business summary, batch-loaded. Collectors (no row, or account_type collector) get COLLECTOR. */
export async function businessSummaries(profileIds: readonly string[]): Promise<Map<string, BusinessSummary>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const out = new Map<string, BusinessSummary>();
  for (const id of ids) out.set(id, COLLECTOR);
  if (!ids.length) return out;
  try {
    const result = await getPool().query<Row>("SELECT * FROM ch_web.business_profiles WHERE profile_id = ANY($1::text[]) AND account_type = 'business'", [ids]);
    for (const row of result.rows) out.set(row.profile_id, summaryOf(row));
  } catch { /* table not migrated yet: everyone is a collector */ }
  return out;
}
export async function businessSummary(profileId: string | null | undefined): Promise<BusinessSummary> {
  if (!profileId) return COLLECTOR;
  return (await businessSummaries([profileId])).get(profileId) || COLLECTOR;
}
/** Compact fields for listing sellers and message peers (no policies). */
export const sellerBusinessFields = (s: BusinessSummary | undefined) => s?.isBusiness ? {isBusiness: true, verified: s.verified, shopName: s.shopName} : {isBusiness: false, verified: false, shopName: null};

export async function ownBusiness(profileId: string): Promise<OwnBusiness | null> {
  try {
    const result = await getPool().query<Row>('SELECT * FROM ch_web.business_profiles WHERE profile_id=$1', [profileId]);
    return result.rows[0] ? ownOf(result.rows[0]) : null;
  } catch (error) { if (missingTable(error)) return null; throw error; }
}

/** Is this media id an active, public business logo? Used by the logo route. */
export async function publicLogoOwner(mediaId: string): Promise<{userId: string; visible: boolean} | null> {
  if (!uuid.test(mediaId)) return null;
  try {
    const result = await getPool().query<{user_id: string; visible: number}>(
      `SELECT b.user_id, p.visible FROM ch_web.business_profiles b JOIN ch_web.profiles p ON p.id=b.profile_id
       WHERE b.logo_media_id=$1 AND b.account_type='business' AND p.moderated=0 AND p.deletion_started_at IS NULL AND p.user_id=b.user_id
       AND NOT EXISTS (SELECT 1 FROM ch_web.account_restrictions r WHERE r.user_id=p.user_id AND r.scope='account') LIMIT 1`, [mediaId]);
    const row = result.rows[0];
    return row ? {userId: row.user_id, visible: !!Number(row.visible)} : null;
  } catch { return null; }
}

/**
 * Save the owner's account type and business details. Changing the shop name, website or location of a
 * verified business removes the tick (status → unverified, source 'details_changed') until an admin checks
 * again; that change is written to the audit trail. Returns the saved record and whether the tick was removed.
 */
export async function saveBusiness(profile: {id: string; userId: string}, requested: BusinessInput): Promise<{business: OwnBusiness; verificationCleared: boolean}> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query<Row>('SELECT * FROM ch_web.business_profiles WHERE profile_id=$1 FOR UPDATE', [profile.id])).rows[0];
    // Switching to a personal profile keeps the stored shop details (hidden) so switching back is painless.
    const input: BusinessInput = requested.accountType === 'collector' && before
      ? {accountType: 'collector', kind: before.business_kind, shopName: before.shop_name, logoId: before.logo_media_id, city: before.city, state: before.state, website: before.website, shippingPolicy: before.shipping_policy, returnsPolicy: before.returns_policy}
      : requested;
    const website = requested.accountType === 'business' ? normalizeWebsite(input.website) : input.website.trim().slice(0, 200);
    const identityChanged = !!before && (before.shop_name !== input.shopName || before.website !== website || before.city !== input.city || before.state !== input.state || before.account_type !== input.accountType);
    const clear = !!before && before.verification_status === 'verified' && identityChanged;
    const saved = (await client.query<Row>(
      `INSERT INTO ch_web.business_profiles (profile_id,user_id,account_type,business_kind,shop_name,logo_media_id,city,state,website,shipping_policy,returns_policy,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (profile_id) DO UPDATE SET user_id=EXCLUDED.user_id,account_type=EXCLUDED.account_type,business_kind=EXCLUDED.business_kind,shop_name=EXCLUDED.shop_name,
        logo_media_id=EXCLUDED.logo_media_id,city=EXCLUDED.city,state=EXCLUDED.state,website=EXCLUDED.website,shipping_policy=EXCLUDED.shipping_policy,returns_policy=EXCLUDED.returns_policy,updated_at=now(),
        verification_status=CASE WHEN $12 THEN 'unverified' ELSE ch_web.business_profiles.verification_status END,
        verification_source=CASE WHEN $12 THEN 'details_changed' ELSE ch_web.business_profiles.verification_source END,
        verified_at=CASE WHEN $12 THEN NULL ELSE ch_web.business_profiles.verified_at END,
        status_changed_at=CASE WHEN $12 THEN now() ELSE ch_web.business_profiles.status_changed_at END,
        status_changed_by=CASE WHEN $12 THEN $2 ELSE ch_web.business_profiles.status_changed_by END
       RETURNING *`,
      [profile.id, profile.userId, input.accountType, input.kind, input.shopName, input.logoId, input.city, input.state, website, input.shippingPolicy, input.returnsPolicy, clear])).rows[0];
    if (clear) await client.query('INSERT INTO ch_web.business_verification_events (id,profile_id,action,status,source,actor_user_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), profile.id, 'cleared', 'unverified', 'details_changed', profile.userId, 'The business changed its name, website, location or account type.']);
    await client.query('COMMIT');
    return {business: ownOf(saved), verificationCleared: clear};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (missingTable(error)) throw new BusinessStorageMissingError();
    throw error;
  } finally { client.release(); }
}

/** Admin grants or removes the tick by hand. Caller must have run requireAdmin(). Audit row is written in the same transaction. */
export async function setBusinessVerified(adminUserId: string, profileId: string, verified: boolean, note: string): Promise<{business: OwnBusiness; userId: string; changed: boolean}> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query<Row>('SELECT * FROM ch_web.business_profiles WHERE profile_id=$1 FOR UPDATE', [profileId])).rows[0];
    if (!before || before.account_type !== 'business') { await client.query('ROLLBACK'); throw Object.assign(new Error('That profile is not a business profile.'), {status: 404}); }
    const status: VerificationStatus = verified ? 'verified' : (before.verification_status === 'verified' ? 'revoked' : before.verification_status);
    const changed = status !== before.verification_status;
    const saved = (await client.query<Row>(
      `UPDATE ch_web.business_profiles SET verification_status=$2, verification_source='admin_manual', verification_note=$3,
        verified_at=CASE WHEN $4 THEN now() ELSE NULL END, verified_by=CASE WHEN $4 THEN $5 ELSE verified_by END,
        status_changed_at=now(), status_changed_by=$5 WHERE profile_id=$1 RETURNING *`,
      [profileId, status, note, verified, adminUserId])).rows[0];
    await client.query('INSERT INTO ch_web.business_verification_events (id,profile_id,action,status,source,actor_user_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), profileId, verified ? 'granted' : 'removed', status, 'admin_manual', adminUserId, note]);
    await client.query('COMMIT');
    return {business: ownOf(saved), userId: saved.user_id, changed};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (missingTable(error)) throw new BusinessStorageMissingError();
    throw error;
  } finally { client.release(); }
}

/** Business profiles for the admin panel, newest first, with their last few audit events. */
export async function listBusinessesForAdmin(filter: {status?: VerificationStatus | 'all'; q?: string; limit?: number}): Promise<AdminBusinessRow[]> {
  const pool = getPool();
  const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
  const q = (filter.q || '').trim().slice(0, 60);
  try {
    const rows = await pool.query<Row & {handle: string; name: string}>(
      `SELECT b.*, p.handle, p.name FROM ch_web.business_profiles b JOIN ch_web.profiles p ON p.id=b.profile_id
       WHERE b.account_type='business' AND ($1::text IS NULL OR b.verification_status=$1)
       AND ($2::text = '' OR b.shop_name ILIKE '%'||$2||'%' OR p.handle ILIKE '%'||$2||'%' OR p.name ILIKE '%'||$2||'%')
       ORDER BY (b.verification_status='verified') ASC, b.updated_at DESC LIMIT $3`,
      [filter.status && filter.status !== 'all' ? filter.status : null, q.replace(/[\\%_]/g, '\\$&'), limit]);
    const ids = rows.rows.map(r => r.profile_id);
    const events = ids.length ? await pool.query<{profile_id: string; action: string; status: string; source: string; actor_user_id: string | null; note: string; created_at: Date}>(
      `SELECT * FROM (SELECT e.*, row_number() OVER (PARTITION BY profile_id ORDER BY created_at DESC) AS n FROM ch_web.business_verification_events e WHERE profile_id = ANY($1::text[])) t WHERE n <= 5 ORDER BY created_at DESC`, [ids]) : {rows: []};
    return rows.rows.map(r => ({...ownOf(r), profileId: r.profile_id, handle: r.handle, name: r.name, verifiedBy: r.verified_by, verificationNote: r.verification_note, statusChangedAt: iso(r.status_changed_at),
      events: events.rows.filter(e => e.profile_id === r.profile_id).map(e => ({action: e.action, status: e.status, source: e.source, actorUserId: e.actor_user_id, note: e.note, createdAt: new Date(e.created_at).toISOString()}))}));
  } catch (error) {
    if (missingTable(error)) throw new BusinessStorageMissingError();
    throw error;
  }
}
