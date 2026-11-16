// GET ?mine=1  → the owner's shop extras (key notes, stocked dates, runs, shop window). Signed in.
// GET ?handle= → the public Collection tab for that profile, following its Shop window. Guests allowed for
//               visible profiles; hidden ones are 404 except to their owner. Never includes value, price, notes or certs.
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {collections,profiles} from '../../../db/schema';
import {emptyVault,vaultSchema} from '../../../lib/vault';
import {privateJson} from '../../../lib/api-security';
import {ownerShop,publicCollection} from '../../../lib/collection-shop';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
async function vaultOf(userId:string){const [row]=await getDb().select().from(collections).where(eq(collections.userId,userId));return row?vaultSchema.parse(JSON.parse(row.data)):emptyVault('Collector')}
export async function GET(req:Request){
 try{
  const url=new URL(req.url),user=await getChatGPTUser(),db=getDb();
  if(url.searchParams.get('mine')==='1'){
   if(!user)return json('Sign in to see your shop.',401);
   const [p]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
   if(!p)return privateJson({keys:{},added:{},runs:[],window:'window'});
   return privateJson(await ownerShop(db as never,p,await vaultOf(user.userId)));
  }
  const handle=(url.searchParams.get('handle')||'').toLowerCase();
  const [p]=await db.select().from(profiles).where(eq(profiles.handle,handle));
  const own=!!p&&!!user&&p.userId===user.userId;
  if(!p||(!own&&(!p.visible||p.moderated||p.deletionStartedAt)))return json('Profile not found.',404);
  return privateJson(await publicCollection(db as never,p,await vaultOf(p.userId)));
 }catch{return json('This collection could not load. Please retry.',500)}
}
