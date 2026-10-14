// Official contract reviewed2026-10-09: Metron master api/README.md and
// metron-project.github.io/blog/{commercial-api-use,token-authentication}.
// Tokens are caller supplied and ephemeral. No shared credential or data cache.
export const METRON_API_ORIGIN = 'https://metron.cloud';
export const METRON_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
export const METRON_BOUNDS = Object.freeze({ requestBytes: 8192, responseBytes: 524288, timeoutMs: 10000, rowsPerPage: 100, maxPage: 1000, minuteBudget: 8 });
const MAX_ID = 2147483647;
const issuePath = '/api/issue/';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_ID;

export type MetronCredit = { creator: string; roles: string[] };
export type MetronIssue = {
  id: number; series: string; number: string; title: string;
  seriesYear: number | null; volume: number | null; publisher: string | null;
  coverDate: string | null; storeDate: string | null; credits: MetronCredit[];
  source: 'Metron'; sourceUrl: string; license: 'CC BY-SA 4.0';
  adaptationNote: 'Formatted metadata; images, synopses and values omitted.';
  artworkIncluded: false; valuationAvailable: false;
};
export type MetronPersonalEntry = {
  title: string; issue: string; grade: string; price: number;
  externalCatalog: { provider: 'Metron'; id: number; sourceUrl: string; license: 'CC BY-SA 4.0' };
};
export type MetronSearch = { seriesName: string; number: string | null };
export type MetronRequest =
  | { action: 'search'; token: string; ownsToken: true; query: string; search: MetronSearch; next: string | null }
  | { action: 'detail'; token: string; ownsToken: true; id: number };
export type MetronUsage = { burstRemaining: number | null; dailyRemaining: number | null; retryAfterSeconds: number | null };
export type MetronResponse = {
  action: 'search' | 'detail'; items: MetronIssue[]; count: number; next: string | null;
  paginationUnavailable: boolean; providerVerified: true; usage: MetronUsage;
};

export class MetronDirectoryError extends Error {
  constructor(message: string, public status: number, public code: string, public retryAfterSeconds?: number) {
    super(message); this.name = 'MetronDirectoryError';
  }
}
const invalid = () => new MetronDirectoryError('Check the Metron token and search fields.', 400, 'metron_invalid_request');

/** Safe Bearer syntax; this is a local bound, not a claim about token validity. */
export function isMetronToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 256 &&
    /^[A-Za-z0-9._~+/-]+={0,2}$/.test(token);
}

export function parseMetronSearch(query: unknown): MetronSearch {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 160 || /[\x00-\x1f\x7f<>]/.test(query)) throw invalid();
  const text = query.trim(), chunks = text.split('#');
  if (chunks.length > 2) throw invalid();
  const seriesName = chunks[0].trim(), number = chunks.length === 2 ? chunks[1].trim() : null;
  if (seriesName.length < 2 || number !== null && !/^[A-Za-z0-9-][A-Za-z0-9./_-]{0,23}$/.test(number)) throw invalid();
  return { seriesName, number };
}

function searchUrl(search: MetronSearch, page?: number): string {
  const url = new URL(issuePath, METRON_API_ORIGIN);
  url.searchParams.set('series_name', search.seriesName);
  if (search.number !== null) url.searchParams.set('number', search.number);
  if (page !== undefined) url.searchParams.set('page', String(page));
  return url.href;
}

/** Upstream pagination is data, never authority to send a credential elsewhere. */
export function safeMetronNext(next: unknown, search: MetronSearch): string | null {
  if (typeof next !== 'string' || next.length > 1000 || !next.startsWith(METRON_API_ORIGIN + '/')) return null;
  let url: URL;
  try { url = new URL(next); } catch { return null; }
  if (url.origin !== METRON_API_ORIGIN || url.pathname !== issuePath || url.username || url.password || url.hash || url.port) return null;
  for (const key of url.searchParams.keys()) if (!['series_name', 'number', 'page'].includes(key) || url.searchParams.getAll(key).length !== 1) return null;
  if (url.searchParams.get('series_name') !== search.seriesName || url.searchParams.get('number') !== search.number) return null;
  const page = url.searchParams.get('page');
  if (!page || !/^[1-9][0-9]{0,3}$/.test(page) || Number(page) < 2 || Number(page) > METRON_BOUNDS.maxPage) return null;
  return searchUrl(search, Number(page));
}

export function parseMetronRequest(body: unknown): MetronRequest {
  if (!record(body) || !isMetronToken(body.token) || body.ownsToken !== true) throw invalid();
  const allowed = body.action === 'search' ? ['action', 'token', 'ownsToken', 'query', 'next'] : ['action', 'token', 'ownsToken', 'id'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw invalid();
  if (body.action === 'detail') {
    if (!positiveId(body.id)) throw invalid();
    return { action: 'detail', token: body.token, ownsToken: true, id: body.id };
  }
  if (body.action !== 'search' || typeof body.query !== 'string' || body.query.includes(body.token)) throw invalid();
  const search = parseMetronSearch(body.query);
  let next: string | null = null;
  if (body.next !== undefined && body.next !== null) {
    next = safeMetronNext(body.next, search);
    if (!next) throw invalid();
  }
  return { action: 'search', token: body.token, ownsToken: true, query: body.query.trim(), search, next };
}

function cleanText(v: unknown, max: number, secret?: string): string | null {
  if (typeof v !== 'string' || secret && v.includes(secret)) return null;
  const text = v.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
  if (!text || secret && text.includes(secret)) return null;
  return text.slice(0, max);
}
function integer(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;
}
function plainDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const parsed = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === v ? v : null;
}

/** Intentionally excludes artwork, HTML synopsis, cover price and valuations. */
export function sanitizeMetronIssue(raw: unknown, secret?: string): MetronIssue | null {
  if (!record(raw) || !positiveId(raw.id) || !record(raw.series)) return null;
  const series = cleanText(raw.series.name, 120, secret), number = cleanText(raw.number, 24, secret);
  if (!series || !number) return null;
  const seriesYear = integer(raw.series.year_began, 1800, 2200), volume = integer(raw.series.volume, 1, 10000);
  const publisher = cleanText(record(raw.publisher) ? raw.publisher.name : record(raw.series.publisher) ? raw.series.publisher.name : null, 120, secret);
  const credits: MetronCredit[] = [];
  if (Array.isArray(raw.credits)) for (const item of raw.credits.slice(0, 40)) {
    if (!record(item)) continue;
    const creator = cleanText(record(item.creator) ? item.creator.name : null, 120, secret);
    if (!creator) continue;
    const roleValues = Array.isArray(item.role) ? item.role : Array.isArray(item.roles) ? item.roles : [];
    const roles = [...new Set(roleValues.slice(0, 10).map(role => cleanText(record(role) ? role.name : null, 60, secret)).filter((role): role is string => role !== null))];
    credits.push({ creator, roles });
  }
  return {
    id: raw.id, series, number, title: series + (seriesYear !== null ? ` (${seriesYear})` : ''),
    seriesYear, volume, publisher, coverDate: plainDate(raw.cover_date), storeDate: plainDate(raw.store_date), credits,
    source: 'Metron', sourceUrl: `${METRON_API_ORIGIN}/issue/${raw.id}/`, license: 'CC BY-SA 4.0',
    adaptationNote: 'Formatted metadata; images, synopses and values omitted.', artworkIncluded: false, valuationAvailable: false,
  };
}

export function metronPersonalEntry(issue: MetronIssue): MetronPersonalEntry {
  return { title: issue.title, issue: '#' + issue.number, grade: 'Condition not recorded', price: 0,
    externalCatalog: { provider: 'Metron', id: issue.id, sourceUrl: `${METRON_API_ORIGIN}/issue/${issue.id}/`, license: 'CC BY-SA 4.0' } };
}

function boundedHeader(headers: Headers, name: string, max: number): number | null {
  const raw = headers.get(name);
  return raw !== null && /^[0-9]{1,12}$/.test(raw) && Number(raw) <= max ? Number(raw) : null;
}
export function metronUsage(headers: Headers, now = Date.now()): MetronUsage {
  const burstRemaining = boundedHeader(headers, 'X-RateLimit-Burst-Remaining', 100000);
  const dailyRemaining = boundedHeader(headers, 'X-RateLimit-Sustained-Remaining', 100000);
  let retry = boundedHeader(headers, 'Retry-After', 86400);
  for (const [remaining, key] of [[burstRemaining, 'X-RateLimit-Burst-Reset'], [dailyRemaining, 'X-RateLimit-Sustained-Reset']] as const) {
    if (remaining !== 0) continue;
    const reset = boundedHeader(headers, key, 100000000000);
    const seconds = reset === null ? 60 : Math.ceil(reset - now / 1000);
    retry = Math.max(retry || 0, Math.min(86400, Math.max(1, seconds)));
  }
  return { burstRemaining, dailyRemaining, retryAfterSeconds: retry === null ? null : Math.max(1, retry) };
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > METRON_BOUNDS.responseBytes) {
    await response.body?.cancel(); throw new MetronDirectoryError('Metron returned more data than this lookup can display.', 502, 'metron_bad_response');
  }
  const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
    await response.body?.cancel(); throw new MetronDirectoryError('Metron did not return a readable metadata response.', 502, 'metron_bad_response');
  }
  if (!response.body) throw new MetronDirectoryError('Metron returned an empty metadata response.', 502, 'metron_bad_response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > METRON_BOUNDS.responseBytes) { await reader.cancel(); throw new MetronDirectoryError('Metron returned more data than this lookup can display.', 502, 'metron_bad_response'); }
      chunks.push(value);
    }
    if (signal.aborted) throw new Error('Lookup aborted.');
  } finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MetronDirectoryError('Metron did not return a readable metadata response.', 502, 'metron_bad_response'); }
}

export async function fetchMetronDirectory(request: MetronRequest, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<MetronResponse> {
  // Revalidate runtime callers even though the exported request type is narrow.
  const checked = parseMetronRequest(request.action === 'search'
    ? { action: request.action, token: request.token, ownsToken: request.ownsToken, query: request.query, next: request.next }
    : request);
  const url = checked.action === 'search' ? checked.next || searchUrl(checked.search) : `${METRON_API_ORIGIN}${issuePath}${checked.id}/`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, METRON_BOUNDS.timeoutMs);
  try {
    const response = await (options.fetcher || fetch)(url, {
      method: 'GET', headers: { Authorization: 'Bearer ' + checked.token, Accept: 'application/json' },
      redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
    });
    const usage = metronUsage(response.headers);
    if (response.status !== 200) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new MetronDirectoryError('Metron did not accept this token or allow this lookup. Check your Metron account.', 424, 'metron_token_rejected');
      if (response.status === 429) throw new MetronDirectoryError('Your Metron account has reached its lookup limit. Wait before trying again.', 429, 'metron_provider_limit', usage.retryAfterSeconds || 60);
      if (response.status === 404) throw new MetronDirectoryError('That Metron record is unavailable.', 404, 'metron_not_found');
      throw new MetronDirectoryError('Metron is unavailable for this lookup. Try again later.', 503, 'metron_unavailable');
    }
    const raw = await boundedJson(response, controller.signal);
    if (checked.action === 'detail') {
      const item = sanitizeMetronIssue(raw, checked.token);
      if (!item || item.id !== checked.id) throw new MetronDirectoryError('Metron returned unexpected issue metadata.', 502, 'metron_bad_response');
      return { action: 'detail', items: [item], count: 1, next: null, paginationUnavailable: false, providerVerified: true, usage };
    }
    if (!record(raw) || !Array.isArray(raw.results) || raw.results.length > METRON_BOUNDS.rowsPerPage || integer(raw.count, 0, 10000000) === null || (raw.count as number) < raw.results.length)
      throw new MetronDirectoryError('Metron returned unexpected search metadata.', 502, 'metron_bad_response');
    const items = raw.results.map(row => sanitizeMetronIssue(row, checked.token)).filter((item): item is MetronIssue => item !== null);
    if (new Set(items.map(item => item.id)).size !== items.length) throw new MetronDirectoryError('Metron returned repeated issue identifiers.', 502, 'metron_bad_response');
    const next = raw.next === null || raw.next === undefined ? null : safeMetronNext(raw.next, checked.search);
    return { action: 'search', items, count: raw.count as number, next,
      paginationUnavailable: raw.next !== null && raw.next !== undefined && next === null, providerVerified: true, usage };
  } catch (error) {
    if (error instanceof MetronDirectoryError) throw error;
    if (timedOut) throw new MetronDirectoryError('Metron took too long to respond. Try again later.', 504, 'metron_timeout');
    throw new MetronDirectoryError('Metron could not be reached. Try again later.', 503, 'metron_unavailable');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

/** Memory-only controller used by the actual directory view and its race tests. */
export function createMetronSession(initialSignedIn: boolean) {
  let signedIn = initialSignedIn, disposed = false, token = '', generation = 0, requestId = 0;
  let active: AbortController | null = null;
  function clear() { generation++; requestId++; token = ''; active?.abort(); active = null; }
  return {
    mount(value: boolean) { disposed = false; if (value !== signedIn) { clear(); signedIn = value; } },
    setSignedIn(value: boolean) { if (value !== signedIn) { clear(); signedIn = value; } },
    connect(value: string) { if (disposed || !signedIn || !isMetronToken(value)) return false; clear(); token = value; return true; },
    disconnect() { clear(); },
    dispose() { clear(); disposed = true; },
    hasToken() { return !disposed && signedIn && !!token; },
    begin() {
      if (disposed || !signedIn || !token || active) return null;
      const controller = new AbortController(), ownToken = token, ownGeneration = generation, ownRequest = ++requestId;
      active = controller;
      return {
        token: ownToken, signal: controller.signal,
        current: () => !disposed && signedIn && token === ownToken && generation === ownGeneration && requestId === ownRequest,
        finish: () => { if (active === controller) active = null; },
      };
    },
  };
}
export type MetronSession = ReturnType<typeof createMetronSession>;
export type MetronClientAction = { action: 'search'; query: string; next?: string | null } | { action: 'detail'; id: number };
export type MetronClientResult = { kind: 'ignored' } | { kind: 'success'; data: MetronResponse };

const clientErrors: Record<string, string> = {
  signin_required: 'Sign in to ComicHuddle first.', profile_required: 'Create your free collector profile first.',
  rules_required: 'Accept the current community rules in your collector profile first.',
  account_unavailable: 'This account is unavailable for directory connections.',
  metron_invalid_request: 'Check the token, series title and optional issue number.',
  metron_token_rejected: 'Metron did not accept this token or allow this lookup. Check your Metron account.',
  metron_app_limit: 'ComicHuddle lookup limit reached. Wait before another Metron request.',
  metron_provider_limit: 'Your Metron account has reached its lookup limit. Wait before trying again.',
  metron_not_found: 'That Metron record is unavailable.', metron_timeout: 'Metron took too long to respond. Try again later.',
  metron_bad_response: 'Metron returned metadata this connection could not display.',
};
function clientIssue(v: unknown): v is MetronIssue {
  if (!record(v) || !positiveId(v.id)) return false;
  const text = (field: unknown, max: number) => typeof field === 'string' && field.length > 0 && field.length <= max &&
    field.trim() === field && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(field) && !/<[^>]*>/.test(field);
  return text(v.series, 120) && text(v.number, 24) && text(v.title, 160) &&
    (v.seriesYear === null || integer(v.seriesYear, 1800, 2200) !== null) &&
    (v.volume === null || integer(v.volume, 1, 10000) !== null) && (v.publisher === null || text(v.publisher, 120)) &&
    (v.coverDate === null || plainDate(v.coverDate) === v.coverDate) && (v.storeDate === null || plainDate(v.storeDate) === v.storeDate) &&
    v.source === 'Metron' && v.sourceUrl === `${METRON_API_ORIGIN}/issue/${v.id}/` && v.license === 'CC BY-SA 4.0' &&
    v.adaptationNote === 'Formatted metadata; images, synopses and values omitted.' && v.artworkIncluded === false && v.valuationAvailable === false &&
    Array.isArray(v.credits) && v.credits.length <= 40 && v.credits.every(item => record(item) && text(item.creator, 120) &&
      Array.isArray(item.roles) && item.roles.length <= 10 && item.roles.every(role => text(role, 60)));
}
function clientResponse(v: unknown, action: MetronClientAction): v is MetronResponse {
  if (!record(v) || v.action !== action.action || v.providerVerified !== true || !Array.isArray(v.items) ||
    v.items.length > METRON_BOUNDS.rowsPerPage || !v.items.every(clientIssue) || new Set(v.items.map(item => item.id)).size !== v.items.length ||
    integer(v.count, 0, 10000000) === null || (v.count as number) < v.items.length || typeof v.paginationUnavailable !== 'boolean' || !record(v.usage)) return false;
  if (![v.usage.burstRemaining, v.usage.dailyRemaining].every(value => value === null || integer(value, 0, 100000) !== null) ||
    !(v.usage.retryAfterSeconds === null || integer(v.usage.retryAfterSeconds, 1, 86400) !== null)) return false;
  if (action.action === 'detail') return v.items.length === 1 && v.items[0].id === action.id && v.count === 1 && v.next === null;
  return v.next === null || typeof v.next === 'string' && safeMetronNext(v.next, parseMetronSearch(action.query)) === v.next;
}
/** One POST per explicit user action. No persistence, background search or retry. */
export async function requestMetronClient(session: MetronSession, action: MetronClientAction, fetcher: typeof fetch = fetch): Promise<MetronClientResult> {
  const ticket = session.begin(); if (!ticket) return { kind: 'ignored' };
  try {
    const response = await fetcher('/api/metron', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: ticket.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action, token: ticket.token, ownsToken: true }),
    });
    if (!ticket.current()) return { kind: 'ignored' };
    const payload: unknown = await response.json();
    if (!ticket.current()) return { kind: 'ignored' };
    if (!response.ok) {
      const code = record(payload) && typeof payload.code === 'string' && clientErrors[payload.code] ? payload.code : 'metron_unavailable';
      throw new MetronDirectoryError(clientErrors[code] || 'The Metron connection is unavailable. Try again later.', response.status, code,
        boundedHeader(response.headers, 'Retry-After', 86400) || undefined);
    }
    if (!clientResponse(payload, action) || JSON.stringify(payload).includes(ticket.token))
      throw new MetronDirectoryError('Metron returned metadata this connection could not display.', 502, 'metron_bad_response');
    return { kind: 'success', data: payload as unknown as MetronResponse };
  } catch (error) {
    if (!ticket.current()) return { kind: 'ignored' };
    if (error instanceof MetronDirectoryError) throw error;
    throw new MetronDirectoryError('The Metron connection is unavailable. Try again later.', 503, 'metron_unavailable');
  } finally { ticket.finish(); }
}
