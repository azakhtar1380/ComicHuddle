import { GET as releases } from '../new-releases/route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  // Continue only an already-active weekly checkpoint, without starting a new
  // daily sweep. Vercel attaches the same protected CRON_SECRET header.
  const url = new URL(request.url); url.searchParams.set('resume','1');
  return releases(new Request(url, { headers: request.headers }));
}
