// Admin-only: revoke or restore a member's trophy tier. Every change goes in the admin audit log (migration 040).
// GET ?handle= lists that member's earned tiers. POST {handle,trophy,tier,revoke,note}.
import {eq} from 'drizzle-orm';
import {z,ZodError} from 'zod';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {profiles} from '../../../../db/schema';
import {AdminRequiredError,requireAdmin} from '../../../../lib/admin';
import {logAdminAction} from '../../../../lib/admin-audit';
import {privateJson} from '../../../../lib/api-security';
import {getPool} from '../../../../db/postgres';
import {adminSetTrophy} from '../../../../lib/trophies';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
async function member(handle:string){const [p]=await getDb().select().from(profiles).where(eq(profiles.handle,handle.toLowerCase()));return p}
export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to continue.',401);requireAdmin(user);
  const p=await member(new URL(req.url).searchParams.get('handle')||'');if(!p)return json('No member with that handle.',404);
  const rows=(await getPool().query<{trophy:string;tier:string;earned_at:Date;revoked_at:Date|null;revoked_by:string|null}>('SELECT trophy,tier,earned_at,revoked_at,revoked_by FROM ch_web.user_trophies WHERE user_id=$1 AND earned_at IS NOT NULL ORDER BY trophy,tier',[p.userId])).rows;
  return privateJson({handle:p.handle,name:p.name,trophies:rows.map(r=>({trophy:r.trophy,tier:r.tier,earnedAt:new Date(r.earned_at).toISOString(),revoked:!!r.revoked_at,byAdmin:!!r.revoked_by}))});
 }catch(error){if(error instanceof AdminRequiredError)return json(error.message,403);return json('Trophies could not load.',500)}
}
export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to continue.',401);requireAdmin(user);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const a=z.object({handle:z.string().max(30),trophy:z.string().max(40),tier:z.enum(['bronze','silver','golden','single']),revoke:z.boolean(),note:z.string().trim().min(3).max(500)}).parse(await req.json());
  const p=await member(a.handle);if(!p)return json('No member with that handle.',404);
  await adminSetTrophy(user.userId,p.userId,a.trophy,a.tier,a.revoke);
  await logAdminAction({admin:user,action:a.revoke?'trophy_revoked':'trophy_restored',targetType:'user_trophy',targetId:`${p.handle}:${a.trophy}:${a.tier}`,detail:{note:a.note}});
  return privateJson({ok:true});
 }catch(error){
  if(error instanceof AdminRequiredError)return json(error.message,403);
  if(error instanceof ZodError)return json('Add a short note and pick a trophy tier.',400);
  const status=(error as {status?:number}).status;if(status)return json((error as Error).message,status);
  return json('That change didn’t save.',500);
 }
}
