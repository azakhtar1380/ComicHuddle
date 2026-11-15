import {getChatGPTUser} from '../../chatgpt-auth';
import {privateJson} from '../../../lib/api-security';
import {avatarUrlForUser} from '../../../lib/avatar';
import {isAdmin,isFounder} from '../../../lib/admin';
export const dynamic='force-dynamic';
// isAdmin only switches admin tools on in the UI; every admin route and action re-checks on the server.
export async function GET(){try{const user=await getChatGPTUser();return privateJson({signedIn:!!user,name:user?.displayName||'Collector',avatarUrl:user?await avatarUrlForUser(user.userId):null,isAdmin:isAdmin(user),isFounder:isFounder(user)})}catch{return privateJson({error:'Account status could not connect.'},503)}}
