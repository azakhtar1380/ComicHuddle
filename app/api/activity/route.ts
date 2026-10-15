import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {getChatGPTUser} from '../../chatgpt-auth';
import {catalogIssue} from '../../../lib/catalog-store';
import {recordCollectorActivity} from '../../../lib/market-pulse-snapshot';
import {privateJson,readObject} from '../../../lib/api-security';
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);const user=await getChatGPTUser();if(!user)return privateJson({recorded:false});const input=z.object({issueId:z.number().int().min(0).max(6500000000),kind:z.literal('view')}).strict().parse(await readObject(request,2000)),db=getDb(),[profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));if(profile&&await catalogIssue(db,input.issueId))await recordCollectorActivity(db,profile,[input.issueId],'view');return privateJson({recorded:!!profile})}catch{return privateJson({recorded:false})}}
