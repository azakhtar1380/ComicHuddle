import { createHash, timingSafeEqual } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!secret || !timingSafeEqual(digest(supplied), digest('Bearer ' + secret))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // The prior GCD/Metron jobs were paused by the owner. Never resume those
  // import scopes simply because a different hosting platform invokes a Cron.
  return Response.json({ status: 'skipped', reason: 'Authorized feed setup and catalog migration review required. Existing importer pauses are preserved.' }, { headers: { 'Cache-Control': 'no-store' } });
}
