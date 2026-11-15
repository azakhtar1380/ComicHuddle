// Admin-only: the admin action audit log (who, what, when). Read-only.
import {getChatGPTUser} from '../../../chatgpt-auth';
import {AdminRequiredError,requireAdmin} from '../../../../lib/admin';
import {privateJson} from '../../../../lib/api-security';
import {listAdminAudit} from '../../../../lib/admin-audit';

export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to continue.'},401);
  requireAdmin(user);
  const url=new URL(req.url),offset=Number(url.searchParams.get('offset')||0),order=url.searchParams.get('order');
  return privateJson(await listAdminAudit({offset:Number.isSafeInteger(offset)?offset:0,limit:50,...(order?{targetType:'order',targetId:order.slice(0,100)}:{})}));
 }catch(error){
  if(error instanceof AdminRequiredError)return privateJson({error:error.message},403);
  return privateJson({error:'The audit log could not be loaded. Try again.'},500);
 }
}
