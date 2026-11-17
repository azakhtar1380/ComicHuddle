// Admin: look up a member's name/handle changes, reset their counts, or rename their handle (for example after
// impersonation). Every action is in the admin audit log and the member gets a notification.
import {z} from 'zod';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getPool} from '../../../../db/postgres';
import {AdminRequiredError,requireAdmin} from '../../../../lib/admin';
import {logAdminAction} from '../../../../lib/admin-audit';
import {privateJson} from '../../../../lib/api-security';
import {notify} from '../../../../lib/notifications';
import {handlePattern} from '../../../../lib/name-rules';
import {handleHeld,nameChangeCounts,recordNameChange,resetNameChanges} from '../../../../lib/profile-names';

export const dynamic='force-dynamic';
type Member={id:string;user_id:string;handle:string;name:string};
async function member(handle:string){const {rows}=await getPool().query<Member>('SELECT id,user_id,handle,name FROM ch_web.profiles WHERE lower(handle)=$1',[handle.toLowerCase().replace(/^@/,'')]);return rows[0]||null}
const fail=(error:unknown)=>error instanceof AdminRequiredError?privateJson({error:error.message},403):error instanceof z.ZodError?privateJson({error:'Check the handle and try again.'},400):privateJson({error:'That didn’t work. Try again.'},500);

export async function GET(req:Request){
 try{requireAdmin(await getChatGPTUser());
  const m=await member(new URL(req.url).searchParams.get('handle')||'');if(!m)return privateJson({error:'No member with that handle.'},404);
  const {rows}=await getPool().query<{kind:string;old_value:string;new_value:string;changed_at:Date}>('SELECT kind,old_value,new_value,changed_at FROM ch_web.profile_name_history WHERE profile_id=$1 ORDER BY changed_at DESC LIMIT 20',[m.id]).catch(()=>({rows:[]}));
  return privateJson({member:{handle:m.handle,name:m.name},used:await nameChangeCounts(m.id),history:rows.map(r=>({kind:r.kind,from:r.old_value,to:r.new_value,at:new Date(r.changed_at).toISOString()}))});
 }catch(error){return fail(error)}
}
export async function POST(req:Request){
 try{
  const admin=requireAdmin(await getChatGPTUser());
  const body=z.discriminatedUnion('action',[z.object({action:z.literal('reset'),handle:z.string().min(3).max(25)}),z.object({action:z.literal('rename'),handle:z.string().min(3).max(25),newHandle:z.string().trim().toLowerCase().regex(handlePattern)})]).parse(await req.json().catch(()=>null));
  const m=await member(body.handle);if(!m)return privateJson({error:'No member with that handle.'},404);
  if(body.action==='reset'){
   await resetNameChanges(m.id);
   await logAdminAction({admin,action:'profile.name_changes_reset',targetType:'profile',targetId:m.id,detail:{handle:m.handle}});
   await notify({userId:m.user_id,kind:'system',title:'Your name and handle changes were reset',body:'You can change your display name and handle again (2 changes each).',href:'/?section=My%20Profile'});
   return privateJson({ok:true});
  }
  if(body.newHandle===m.handle.toLowerCase())return privateJson({error:'That is already their handle.'},400);
  const taken=await member(body.newHandle);if(taken)return privateJson({error:'That handle is taken.'},409);
  if(await handleHeld(body.newHandle,m.id))return privateJson({error:'That handle was given up recently and is held for 30 days.'},409);
  await getPool().query('UPDATE ch_web.profiles SET handle=$2 WHERE id=$1',[m.id,body.newHandle]);
  await recordNameChange({profileId:m.id,kind:'handle',oldValue:m.handle,newValue:body.newHandle,changedBy:admin.userId,count:false});
  await logAdminAction({admin,action:'profile.handle_renamed',targetType:'profile',targetId:m.id,detail:{from:m.handle,to:body.newHandle}});
  await notify({userId:m.user_id,kind:'system',title:'Your handle was changed by ComicHuddle',body:'Your handle is now @'+body.newHandle+'. Contact support if you have questions.',href:'/@'+body.newHandle});
  return privateJson({ok:true,handle:body.newHandle});
 }catch(error){return fail(error)}
}
