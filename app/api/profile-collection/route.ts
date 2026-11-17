// The profile's Collection tab. GET ?mine=1 (signed in): every copy, key notes, visibility and the value
// estimate (owner only). GET ?handle=: the read-only view for visitors, following "Show my collection".
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {collections,profiles} from '../../../db/schema';
import {emptyVault,vaultSchema} from '../../../lib/vault';
import {privateJson} from '../../../lib/api-security';
import {collectionCopies,collectionEstimate,publicCollectionView,visibilityOf} from '../../../lib/profile-collection';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
async function vaultOf(userId:string){const [row]=await getDb().select().from(collections).where(eq(collections.userId,userId));return row?vaultSchema.parse(JSON.parse(row.data)):emptyVault('Collector')}
export async function GET(req:Request){
 try{
  const url=new URL(req.url),user=await getChatGPTUser(),db=getDb();
  if(url.searchParams.get('mine')==='1'){
   if(!user)return json('Sign in to see your collection.',401);
   const [p]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
   const vault=await vaultOf(user.userId);
   const [copies,visibility]=await Promise.all([collectionCopies(db as never,vault),p?visibilityOf(p.id):Promise.resolve('keys' as const)]);
   return privateJson({copies,visibility,total:copies.length,...(url.searchParams.get('estimate')==='1'?{estimate:await collectionEstimate(db as never,vault)}:{})});
  }
  const [p]=await db.select().from(profiles).where(eq(profiles.handle,(url.searchParams.get('handle')||'').toLowerCase()));
  const own=!!p&&!!user&&p.userId===user.userId;
  if(!p||(!own&&(!p.visible||p.moderated||p.deletionStartedAt)))return json('Profile not found.',404);
  return privateJson(await publicCollectionView(db as never,p.id,await vaultOf(p.userId)));
 }catch{return json('This collection could not load. Please retry.',500)}
}
