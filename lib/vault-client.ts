import {emptyVault, vaultSchema, type Vault} from './vault';

export const vaultVersionHeader = 'X-ComicHuddle-Vault-Version';
export type VaultSnapshot = {data: Vault; version: string};
type Fetcher = typeof fetch;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Compression proxies may turn HTTP ETags into weak validators. The dedicated
// version header is an opaque application revision and survives that change.
export function readVaultVersion(headers: Headers): string | null {
  const value = headers.get(vaultVersionHeader) || headers.get('ETag');
  if (!value) return null;
  const revision = value.trim().replace(/^W\//, '');
  return /^"[A-Za-z0-9-]{1,100}"$/.test(revision) ? revision : null;
}

export async function readVault(name: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<VaultSnapshot> {
  const response = await fetcher('/api/vault', {credentials: 'same-origin', cache: 'no-store', signal});
  if (!response.ok) throw Error('Your collection could not connect. Please retry.');
  const payload: unknown = await response.json();
  const version = readVaultVersion(response.headers);
  if (!version) throw Error('Your collection version could not be read. Please retry.');
  return {data: payload === null ? emptyVault(name) : vaultSchema.parse(payload), version};
}

export class VaultConflictError extends Error {
  constructor(public readonly latest: VaultSnapshot, message = 'Another tab changed the same collection entry. Your latest collection is loaded; review this entry and retry.') {
    super(message);
    this.name = 'VaultConflictError';
  }
}

function mergeRecords<T>(before: T[], next: T[], latest: T[], key: (item: T) => string, conflict: () => never): T[] {
  const old = new Map(before.map(item => [key(item), item]));
  const requested = new Map(next.map(item => [key(item), item]));
  const current = new Map(latest.map(item => [key(item), item]));
  for (const id of new Set([...old.keys(), ...requested.keys()])) {
    const a = old.get(id), b = requested.get(id), remote = current.get(id);
    if (same(a, b)) continue;
    if (!same(remote, a) && !same(remote, b)) conflict();
    if (b === undefined) current.delete(id); else current.set(id, b);
  }
  return [...current.values()];
}

function mergeMembership<T extends string | number>(before: T[], next: T[], latest: T[]): T[] {
  const old = new Set(before), requested = new Set(next), result = new Set(latest);
  for (const value of old) if (!requested.has(value)) result.delete(value);
  for (const value of requested) if (!old.has(value)) result.add(value);
  return [...result];
}

// Apply only this action's changes, preserving books and wants added elsewhere.
// Conflicting edits to the same copy fail visibly instead of overwriting data.
export function mergeVaultChange(before: Vault, next: Vault, latest: VaultSnapshot): Vault {
  before = vaultSchema.parse(before); next = vaultSchema.parse(next);
  const current = latest.data, conflict = (): never => {throw new VaultConflictError(latest);};
  const scalar = <T>(old: T, requested: T, remote: T): T => {
    if (same(old, requested)) return remote;
    if (!same(remote, old) && !same(remote, requested)) conflict();
    return requested;
  };
  const books = mergeRecords(before.books, next.books, current.books, book => book.id, conflict);
  const owned = new Set(books.map(book => book.id));
  const merged = {
    profile: scalar(before.profile, next.profile, current.profile), books,
    wants: mergeMembership(before.wants, next.wants, current.wants),
    posts: scalar(before.posts, next.posts, current.posts),
    likes: mergeMembership(before.likes, next.likes, current.likes),
    tradeBookIds: mergeMembership(before.tradeBookIds, next.tradeBookIds, current.tradeBookIds).filter(id => owned.has(id)),
    clubs: mergeMembership(before.clubs, next.clubs, current.clubs),
    watchlist: mergeRecords(before.watchlist, next.watchlist, current.watchlist, item => `${item.issueId}:${item.mode}:${item.grade}`, conflict),
    tradeDrafts: mergeRecords(before.tradeDrafts, next.tradeDrafts, current.tradeDrafts, item => item.id, conflict),
  };
  const parsed = vaultSchema.safeParse(merged);
  if (!parsed.success) return conflict();
  return parsed.data;
}

export async function saveVaultChange(before: Vault, next: Vault, snapshot: VaultSnapshot | null, name: string, fetcher: Fetcher = fetch): Promise<VaultSnapshot> {
  let latest = snapshot ?? await readVault(name, fetcher);
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = mergeVaultChange(before, next, latest);
    const response = await fetcher('/api/vault', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'If-Match': latest.version, [vaultVersionHeader]: latest.version},
      body: JSON.stringify(data),
    });
    if (response.status === 409 || response.status === 428) {
      latest = await readVault(name, fetcher);
      continue;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as {error?: string};
      throw Error(body.error || 'Your change was not saved. Please retry.');
    }
    const version = readVaultVersion(response.headers);
    // If a host strips both validators, reload after the acknowledged save.
    // The copy's stable ID makes a later retry idempotent, never a duplicate.
    return version ? {data, version} : readVault(name, fetcher);
  }
  throw new VaultConflictError(latest, 'Your collection is being edited in another tab. Your latest collection is loaded; please retry.');
}
