// The signed-in account's own admin status, for client components that show admin tools and the badge.
// Returns only booleans about the caller. Signed-out and non-admin callers get {admin:false}.
import {getChatGPTUser} from '../../../chatgpt-auth';
import {isAdmin,isFounder} from '../../../../lib/admin';
import {privateJson} from '../../../../lib/api-security';

export const dynamic='force-dynamic';
export async function GET(){
 try{
  const user=await getChatGPTUser();
  return privateJson({admin:isAdmin(user),founder:isFounder(user)});
 }catch{return privateJson({admin:false,founder:false})}
}
