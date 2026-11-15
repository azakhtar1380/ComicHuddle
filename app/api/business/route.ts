// Personal or business profiles and the verified-business tick (migration 041).
//   GET  ?logo=<mediaId>[&size=thumbnail]  a public business logo (only while it is that business's logo)
//   GET  ?kind=mine                        your own account type + business details + verification state
//   GET  ?kind=admin_list[&status=&q=]     admins only: business profiles with their audit trail
//   POST {action:'save', accountType, kind, shopName, logoId, city, state, website, shippingPolicy, returnsPolicy}
//   POST {action:'set_verified', profileId, verified, note}   admins only (requireAdmin), audited, notifies the business
// Logos are uploaded with the existing /api/media upload; this route only links one you own.
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {media,profiles} from '../../../db/schema';
import {env} from '../../../lib/runtime-env';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readObject} from '../../../lib/api-security';
import {AdminRequiredError,requireAdmin} from '../../../lib/admin';
import {notify} from '../../../lib/notifications';
import {previewRulesVersion} from '../../../lib/community';
import {BusinessStorageMissingError,businessInputSchema,listBusinessesForAdmin,ownBusiness,publicLogoOwner,saveBusiness,setBusinessVerified} from '../../../lib/business-profile';

export const dynamic = 'force-dynamic';
const fail = (error: string, status: number) => privateJson({error}, status);
const sameOrigin = (req: Request) => req.headers.get('origin') === new URL(req.url).origin;

function handle(error: unknown) {
  if (error instanceof AdminRequiredError) return fail(error.message, 403);
  if (error instanceof BusinessStorageMissingError) return fail(error.message, 503);
  if (error instanceof ApiRequestError) return fail(error.message, error.status);
  if (error instanceof z.ZodError) return fail(error.issues.find(i => i.code === 'custom')?.message || 'Please check the fields and try again.', 400);
  const status = (error as {status?: number})?.status;
  if (status === 404 && error instanceof Error) return fail(error.message, 404);
  return fail('Couldn’t save that. Please try again.', 500);
}

async function logo(req: Request, id: string) {
  const owner = await publicLogoOwner(id);
  if (!owner) return fail('Logo not found.', 404);
  // Hidden profiles still show their logo to signed-in members; guests see only public ones.
  if (!owner.visible && !await getChatGPTUser()) return fail('Logo not found.', 404);
  const [asset] = await getDb().select().from(media).where(eq(media.id, id));
  if (!asset || asset.userId !== owner.userId || !env.BUCKET) return fail('Logo not found.', 404);
  const thumbnail = new URL(req.url).searchParams.get('size') === 'thumbnail';
  const rendition = thumbnail ? await env.BUCKET.get('thumbnails/' + id) : null;
  const object = rendition || await env.BUCKET.get('photos/' + id);
  if (!object) return fail('Logo not found.', 404);
  return new Response(object.body as BodyInit, {headers: {'Content-Type': rendition ? 'image/webp' : asset.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline'}});
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const logoId = url.searchParams.get('logo');
    if (logoId !== null) return await logo(req, logoId);
    const user = await getChatGPTUser();
    if (!user) return fail('Sign in to continue.', 401);
    const kind = url.searchParams.get('kind');
    if (kind === 'mine') {
      const [profile] = await getDb().select().from(profiles).where(eq(profiles.userId, user.userId));
      return privateJson({profileId: profile?.id || null, business: profile ? await ownBusiness(profile.id) : null});
    }
    if (kind === 'admin_list') {
      requireAdmin(user);
      const status = z.enum(['all', 'unverified', 'pending', 'verified', 'revoked']).catch('all').parse(url.searchParams.get('status') || 'all');
      return privateJson({businesses: await listBusinessesForAdmin({status, q: url.searchParams.get('q') || ''})});
    }
    return fail('Unknown request.', 400);
  } catch (error) { return handle(error); }
}

export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return fail('Sign in to continue.', 401);
    if (!sameOrigin(req)) return fail('Request origin rejected.', 403);
    const body = await readObject(req, 16384);
    const db = getDb();

    if (body.action === 'set_verified') {
      requireAdmin(user);
      const limited = await enforceWriteLimits(db, user.userId, 'business:set_verified', 60);
      if (limited) return limited;
      const v = z.object({action: z.literal('set_verified'), profileId: z.string().min(1).max(100), verified: z.boolean(), note: z.string().trim().max(300).default('')}).strict().parse(body);
      const result = await setBusinessVerified(user.userId, v.profileId, v.verified, v.note);
      if (result.changed) await notify({
        userId: result.userId, kind: 'verification', href: '/verified',
        title: v.verified ? 'Your business is verified' : 'Your verified tick was removed',
        body: v.verified ? `${result.business.shopName} now shows the Verified business tick on your profile, listings and messages.`
          : `${result.business.shopName} no longer shows the Verified business tick.${v.note ? ' Note from ComicHuddle: ' + v.note : ''}`,
      });
      return privateJson({saved: true, business: result.business, changed: result.changed});
    }

    if (body.action === 'save') {
      const limited = await enforceWriteLimits(db, user.userId, 'business:save', 20);
      if (limited) return limited;
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.userId));
      if (!profile) return fail('Create your free profile first.', 403);
      if (profile.moderated || profile.deletionStartedAt || await isRestricted(db, user.userId)) return fail('Your account is restricted pending moderation review.', 403);
      if (profile.rulesVersion !== previewRulesVersion || !profile.rulesAcceptedAt) return fail('Accept the current community rules on your profile first.', 403);
      const {action: _action, ...rest} = body; void _action;
      const input = businessInputSchema.parse(rest);
      if (input.logoId) {
        const [asset] = await db.select().from(media).where(eq(media.id, input.logoId));
        if (!asset || asset.userId !== user.userId) return fail('Upload your logo again, then save.', 400);
      }
      const result = await saveBusiness({id: profile.id, userId: user.userId}, input);
      return privateJson({saved: true, business: result.business, verificationCleared: result.verificationCleared});
    }

    return fail('Unknown action.', 400);
  } catch (error) { return handle(error); }
}
