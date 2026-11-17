// Changes left for the signed-in member's display name and @handle (null = unlimited: admins and the Founder).
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {isAdmin} from '../../../lib/admin';
import {privateJson} from '../../../lib/api-security';
import {changesLeftFor} from '../../../lib/profile-names';

export const dynamic='force-dynamic';
export async function GET(){
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in first.'},401);
 const [p]=await getDb().select({id:profiles.id}).from(profiles).where(eq(profiles.userId,user.userId));
 if(!p)return privateJson({name:null,handle:null,firstTime:true});
 try{return privateJson({...(await changesLeftFor(p.id,isAdmin(user))),firstTime:false})}catch{return privateJson({error:'Couldn’t load your changes left.'},500)}
}
