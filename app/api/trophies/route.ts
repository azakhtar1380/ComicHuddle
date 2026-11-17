// Trophies. GET: your trophy case (counts, earned tiers, next tier) and notification switches.
// GET ?unseen=1: the next unlock to celebrate (shown once). GET ?handle=: a profile's trophy case preview (public).
// POST {action:'seen',trophy,tier} | {action:'prefs',unlocks,almost,weekly} | {action:'refresh'}.
import {eq} from 'drizzle-orm';
import {z,ZodError} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {privateJson} from '../../../lib/api-security';
import {awardTrophies,markSeen,nextUnseen,saveTrophyPrefs,trophyPrefs,trophyPreview,trophyStatus} from '../../../lib/trophies';
import {FAIR_PLAY_RULES} from '../../../lib/trophy-defs';
import {nudgeOriginStory} from '../../../lib/origin-story';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
export async function GET(req:Request){
 try{
  const url=new URL(req.url),handle=url.searchParams.get('handle');
  if(handle){
   const [p]=await getDb().select().from(profiles).where(eq(profiles.handle,handle.toLowerCase()));
   const user=await getChatGPTUser();
   if(!p||((!p.visible||p.moderated||p.deletionStartedAt)&&p.userId!==user?.userId))return json('Profile not found.',404);
   return privateJson(await trophyPreview(p.userId));
  }
  const user=await getChatGPTUser();if(!user)return json('Sign in to see your trophies.',401);
  if(url.searchParams.get('unseen')==='1')return privateJson({unlock:await nextUnseen(user.userId)});
  return privateJson({trophies:await trophyStatus(user.userId),prefs:await trophyPrefs(user.userId),fairPlay:FAIR_PLAY_RULES});
 }catch{return json('Trophies could not load. Please retry.',500)}
}
const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('seen'),trophy:z.string().max(40),tier:z.enum(['bronze','silver','golden','single'])}),
 z.object({action:z.literal('prefs'),unlocks:z.boolean(),almost:z.boolean(),weekly:z.boolean()}),
 z.object({action:z.literal('refresh')}),
]);
export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in first.',401);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const a=body.parse(await req.json().catch(()=>null));
  if(a.action==='seen'){await markSeen(user.userId,a.trophy,a.tier);return privateJson({ok:true})}
  if(a.action==='prefs'){await saveTrophyPrefs(user.userId,a);return privateJson({prefs:a})}
  const result=await awardTrophies(user.userId);await nudgeOriginStory(user.userId).catch(()=>undefined);return privateJson({earned:result.earned.length});
 }catch(error){if(error instanceof ZodError)return json('Check that request.',400);return json('That didn’t save. Please retry.',500)}
}
