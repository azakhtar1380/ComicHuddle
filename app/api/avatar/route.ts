// Member profile pictures. POST raw image bytes (JPEG, PNG or WebP, ≤ 4 MB) to set or replace,
// DELETE to remove, GET ?id= to read. Pictures are squared to 320×320 WebP on the server, stored in the
// existing photo store under avatars/<id>, and linked in ch_web.profile_avatars (migration 033).
import sharp from 'sharp';
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {getPool} from '../../../db/postgres';
import {profiles} from '../../../db/schema';
import {env} from '../../../lib/runtime-env';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readBytes} from '../../../lib/api-security';
import {avatarUrlFor} from '../../../lib/avatar';

export const dynamic = 'force-dynamic';
const json = (error: string, status: number) => privateJson({error}, status);
const MAX = 4194304;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

async function squareAvatar(bytes: Uint8Array) {
  try {
    const source = sharp(bytes, {limitInputPixels: 16000000, animated: false, failOn: 'error'});
    const meta = await source.metadata();
    if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64 || (meta.pages || 1) > 1 || !['jpeg', 'png', 'webp'].includes(meta.format || '')) throw Error('invalid');
    return await source.rotate().resize({width: 320, height: 320, fit: 'cover', position: 'attention'}).webp({quality: 84}).toBuffer();
  } catch {
    throw new ApiRequestError('Use a JPEG, PNG or WebP photo at least 64 pixels wide and under 4 MB.', 400);
  }
}

async function ownProfile(userId: string) {
  const db = getDb();
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return {db, profile};
}

export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return json('Sign in to add a profile picture.', 401);
    if (req.headers.get('origin') !== new URL(req.url).origin) return json('Request origin rejected.', 403);
    const {db, profile} = await ownProfile(user.userId);
    if (!profile) return json('Create your free collector profile first, then add a picture.', 403);
    if (profile.moderated || await isRestricted(db, user.userId)) return json('Your account is restricted pending moderation review.', 403);
    const limited = await enforceWriteLimits(db, user.userId, 'avatar:upload', 6);
    if (limited) return limited;
    const image = await squareAvatar(await readBytes(req, MAX));
    const id = crypto.randomUUID(), pool = getPool();
    const previous = await pool.query<{avatar_id: string}>('SELECT avatar_id FROM ch_web.profile_avatars WHERE profile_id=$1', [profile.id]);
    await env.BUCKET.put('avatars/' + id, image, {httpMetadata: {contentType: 'image/webp'}});
    await pool.query('INSERT INTO ch_web.profile_avatars (profile_id,user_id,avatar_id,updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (profile_id) DO UPDATE SET avatar_id=EXCLUDED.avatar_id,user_id=EXCLUDED.user_id,updated_at=now()', [profile.id, user.userId, id]);
    const old = previous.rows[0]?.avatar_id;
    if (old && old !== id) await env.BUCKET.delete('avatars/' + old).catch(() => undefined);
    return privateJson({avatarUrl: avatarUrlFor(id)});
  } catch (error) {
    if (error instanceof ApiRequestError) return json(error.message, error.status);
    return json('Your picture could not be saved. Please try again.', 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return json('Sign in first.', 401);
    if (req.headers.get('origin') !== new URL(req.url).origin) return json('Request origin rejected.', 403);
    const {db, profile} = await ownProfile(user.userId);
    if (!profile) return privateJson({avatarUrl: null});
    const limited = await enforceWriteLimits(db, user.userId, 'avatar:upload', 6);
    if (limited) return limited;
    const pool = getPool();
    const removed = await pool.query<{avatar_id: string}>('DELETE FROM ch_web.profile_avatars WHERE profile_id=$1 RETURNING avatar_id', [profile.id]);
    for (const row of removed.rows) await env.BUCKET.delete('avatars/' + row.avatar_id).catch(() => undefined);
    return privateJson({avatarUrl: null});
  } catch {
    return json('Your picture could not be removed. Please try again.', 500);
  }
}

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!idPattern.test(id)) return json('Picture not found.', 404);
    const row = await getPool().query<{visible: number; moderated: number | boolean | null; deletion_started_at: string | null}>(
      'SELECT p.visible, p.moderated, p.deletion_started_at FROM ch_web.profile_avatars a JOIN ch_web.profiles p ON p.id=a.profile_id WHERE a.avatar_id=$1', [id]);
    const owner = row.rows[0];
    if (!owner || owner.moderated || owner.deletion_started_at) return json('Picture not found.', 404);
    // Hidden profiles still show their picture to signed-in members they talk to; guests see only public ones.
    if (!Number(owner.visible) && !await getChatGPTUser()) return json('Picture not found.', 404);
    const object = await env.BUCKET.get('avatars/' + id);
    if (!object) return json('Picture not found.', 404);
    return new Response(Buffer.from(object.body), {headers: {'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff'}});
  } catch {
    return json('Picture not found.', 404);
  }
}
