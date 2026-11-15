import {getChatGPTUser} from '../../chatgpt-auth';
import {privateJson} from '../../../lib/api-security';
import {avatarUrlForUser} from '../../../lib/avatar';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await getChatGPTUser();return privateJson({signedIn:!!user,name:user?.displayName||'Collector',avatarUrl:user?await avatarUrlForUser(user.userId):null})}catch{return privateJson({error:'Account status could not connect.'},503)}}
