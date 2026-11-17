// Admin-only: review and remove member cover photos. Every action is checked here on the server
// and written to the admin audit log. Members can add and report photos; only admins remove them.
import {queueTrophies} from '../../../../lib/trophies';
import {getPool} from '../../../../db/postgres';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {AdminRequiredError,requireAdmin} from '../../../../lib/admin';
import {logAdminAction} from '../../../../lib/admin-audit';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../../lib/api-security';
import {adminCoverAction,adminCoverQueue,adminModerateCover} from '../../../../lib/community-covers';

export const runtime='nodejs';export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);

/** ?view=review (default): waiting for approval or reported. ?view=recent: the latest uploads. */
export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to continue.',401);
  requireAdmin(user);
  const view=new URL(req.url).searchParams.get('view')==='recent'?'recent':'review';
  return privateJson({view,covers:await adminCoverQueue(getDb(),view)});
 }catch(error){
  if(error instanceof AdminRequiredError)return json(error.message,403);
  return json('Cover photos could not be loaded. Try again.',500);
 }
}

/** Body: {action:'approve'|'remove', mediaId}. */
export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to continue.',401);
  requireAdmin(user);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const input=adminCoverAction.safeParse(await readObject(req,1000));if(!input.success)return json('Choose a cover photo and an action.',400);
  const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'admin:covers',60);if(limited)return limited;
  const result=await adminModerateCover(db,input.data.action,input.data.mediaId);
  await logAdminAction({admin:user,action:'cover.'+input.data.action,targetType:'issue',targetId:String(result.issueId),detail:{mediaId:input.data.mediaId,kind:result.kind}});
  if(input.data.action==='approve')void getPool().query<{user_id:string}>('SELECT user_id FROM ch_web.community_covers WHERE media_id=$1',[input.data.mediaId]).then(r=>queueTrophies(r.rows.map(row=>row.user_id))).catch(()=>undefined);
  return privateJson({ok:true,...result});
 }catch(error){
  if(error instanceof AdminRequiredError)return json(error.message,403);
  if(error instanceof ApiRequestError)return json(error.message,error.status);
  return json('That change could not be saved. Try again.',500);
 }
}
