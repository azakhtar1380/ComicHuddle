import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from '../../../../db';
import { gcdSyncStep, getGcdSyncStatus } from '../../../../lib/gcd-sync';
import {refreshNativeCatalogState} from '../../../../lib/native-catalog-state';
import { ApiRequestError } from '../../../../lib/api-security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!secret || !timingSafeEqual(digest(supplied), digest('Bearer ' + secret))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const json = (body: unknown, status = 200, retryAfter = 0) => Response.json(body, { status,
    headers: { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
  if (process.env.GCD_WEEKLY_SYNC_ENABLED !== 'true') return json({ status: 'disabled', reason: 'Weekly release sync is disabled by the operator.' });
  const db = getDb();
  try {
    let status = await getGcdSyncStatus(db);
    if (new URL(request.url).searchParams.get('status') === '1') return json({ status: 'configured', schedule: 'weekly', source: 'GCD', checkpoint: status });
    const coverage=await refreshNativeCatalogState();
    if (new URL(request.url).searchParams.get('resume') === '1' && status.daily.stage !== 'importing') return json({ status: 'idle', reason: 'No weekly release checkpoint needs continuation.',coverage });
    // Explicitly authorized weekly release scope only; never run historical
    // backfill or re-enable the stopped private Site/Metron tasks.
    const deadline = Date.now() + 270_000;
    let steps = 0;
    while (steps < 100 && Date.now() < deadline && !status.pausedByOwner && status.retryAfter === 0) {
      status = await gcdSyncStep(db, 'daily', {}, { onlyMissing: true }); steps++;
      if (status.daily.stage === 'complete') break;
    }
    return json({ status: status.pausedByOwner ? 'paused' : status.retryAfter ? 'quota_wait' : status.daily.stage === 'complete' ? 'completed' : 'checkpoint_saved',
      steps, coverage, checkpoint: status }, 200, status.retryAfter);
  } catch (error) {
    const status = await getGcdSyncStatus(db);
    if (error instanceof ApiRequestError && [429,409].includes(error.status)) return json({ status: 'checkpoint_saved', checkpoint: status }, 200, status.retryAfter);
    console.error('ComicHuddle weekly GCD import stopped; provider/database details were withheld.');
    return json({ status: 'stopped', reason: error instanceof ApiRequestError ? error.message : 'Validated import could not be completed; checkpoint retained.', checkpoint: status }, 503);
  }
}
