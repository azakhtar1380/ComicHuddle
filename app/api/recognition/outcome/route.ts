import {createHmac,randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '../../../../db';
import {catalogIssue} from '../../../../lib/catalog-store';
import {privateJson,readObject} from '../../../../lib/api-security';
export const runtime='nodejs';
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);
 const input=z.object({result:z.enum(['confirmed','corrected','no_match']),issueId:z.number().int().min(0).max(6500000000).nullable()}).strict().parse(await readObject(request,1000)),db=getDb(),secret=process.env.BETTER_AUTH_SECRET;if(!secret)return privateJson({saved:false},503);
 const address=request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'unknown',actor=createHmac('sha256',secret).update('scanner-outcome:'+address+':'+new Date().toISOString().slice(0,10)).digest('hex'),key=createHmac('sha256',secret).update('scanner-outcome-rate:'+actor).digest('hex');
 const rate=await db.execute(sql`INSERT INTO ch_web.catalog_scan_rate_limits(client_key,window_start,requests) VALUES(${key},now(),1) ON CONFLICT(client_key) DO UPDATE SET requests=catalog_scan_rate_limits.requests+1 RETURNING requests`);if(Number(rate.rows[0].requests)>40)return privateJson({saved:false},429);
 if(input.issueId!==null&&!await catalogIssue(db,input.issueId))return privateJson({saved:false},400);
 await db.execute(sql`INSERT INTO ch_web.scanner_outcomes(id,actor_key,result,issue_id) VALUES(${randomUUID()}::uuid,${actor},${input.result},${input.issueId})`);return privateJson({saved:true});
 }catch{return privateJson({saved:false},400)}}
