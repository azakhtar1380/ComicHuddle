// Fast check used by proxy.ts before /@handle renders, so hidden or unknown profiles get a real 404 status
// (a streamed page would already have sent 200). 200 when the profile is public or it is the viewer's own.
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {handlePattern} from '../../../lib/public-profile';

export const dynamic='force-dynamic';
const reply=(status:number)=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
 const handle=(new URL(req.url).searchParams.get('handle')||'').toLowerCase();
 if(!handlePattern.test(handle))return reply(404);
 try{
  const [p]=await getDb().select({userId:profiles.userId,visible:profiles.visible,moderated:profiles.moderated,deletion:profiles.deletionStartedAt}).from(profiles).where(eq(profiles.handle,handle));
  if(!p)return reply(404);
  if(p.visible&&!p.moderated&&!p.deletion)return reply(200);
  const user=await getChatGPTUser();
  return reply(user&&user.userId===p.userId?200:404);
 }catch{return reply(503)}
}
