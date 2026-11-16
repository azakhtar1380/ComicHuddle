// Runs the member is building. GET: your runs with owned/missing computed from your vault.
// POST {action:'create',issueId,from,to,title?} | {action:'delete',id} | {action:'missing',id} (Directory ids to add to wants).
import {eq} from 'drizzle-orm';
import {ZodError,z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {collections,profiles} from '../../../db/schema';
import {emptyVault,vaultSchema} from '../../../lib/vault';
import {enforceWriteLimits,isRestricted,privateJson} from '../../../lib/api-security';
import {RunError,createRun,deleteRun,listRuns,missingIssueIds,runInput} from '../../../lib/collection-runs';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
async function vaultOf(userId:string){const [row]=await getDb().select().from(collections).where(eq(collections.userId,userId));return row?vaultSchema.parse(JSON.parse(row.data)):emptyVault('Collector')}
export async function GET(){
 try{const user=await getChatGPTUser();if(!user)return json('Sign in to see your runs.',401);
  return privateJson({runs:await listRuns(getDb() as never,user.userId,await vaultOf(user.userId))})}
 catch{return json('Your runs could not load. Please retry.',500)}
}
const action=z.discriminatedUnion('action',[z.object({action:z.literal('create')}).passthrough(),z.object({action:z.literal('delete'),id:z.string().uuid()}),z.object({action:z.literal('missing'),id:z.string().uuid()})]);
export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to track runs.',401);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const db=getDb();const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
  if(!profile)return json('Create your free collector profile first.',403);
  if(profile.moderated||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
  const limited=await enforceWriteLimits(db,user.userId,'collection:runs',40);if(limited)return limited;
  const body=await req.json(),a=action.parse(body),vault=await vaultOf(user.userId);
  if(a.action==='create'){const {action:_,...rest}=body as Record<string,unknown>;void _;const id=await createRun(db as never,user.userId,runInput.parse(rest));return privateJson({id,runs:await listRuns(db as never,user.userId,vault)})}
  if(a.action==='delete'){await deleteRun(db as never,user.userId,a.id);return privateJson({runs:await listRuns(db as never,user.userId,vault)})}
  return privateJson({issueIds:await missingIssueIds(db as never,user.userId,a.id,vault)});
 }catch(error){
  if(error instanceof ZodError)return json(error.issues[0]?.message||'Check the run details.',400);
  if(error instanceof RunError)return json(error.message,error.status);
  return json('That run could not be saved. Please retry.',500);
 }
}
