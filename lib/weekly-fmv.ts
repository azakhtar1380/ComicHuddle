import {z} from 'zod';
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {importSoldComps,soldCompSchema} from './sold-comps';
const feedSchema=z.object({rightsConfirmed:z.literal(true),rightsReference:z.string().min(5).max(300),rightsExpiresAt:z.string().datetime(),comps:z.array(soldCompSchema).max(300)}).strict();
/** Authorized structured sales feeds only. Public eBay sold HTML is not scraped. */
export async function syncWeeklyFmv(db:CatalogDb,environment:NodeJS.ProcessEnv){
 if(environment.FMV_WEEKLY_SYNC_ENABLED!=='true')return {status:'disabled',reason:'Weekly FMV ingestion is disabled.'};
 if(!environment.FMV_LICENSED_FEED_URL||!environment.FMV_LICENSED_FEED_TOKEN)return {status:'setup_required',reason:'Connect an authorized completed-sales feed or import licensed sales comps. No prices were generated.'};
 const url=new URL(environment.FMV_LICENSED_FEED_URL);
 const hosts=(environment.FMV_LICENSED_FEED_HOSTS||'').split(',').map(host=>host.trim()).filter(Boolean);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname)||!hosts.length)throw Error('Authorized feed host configuration requires review.');
 const response=await fetch(url,{headers:{Authorization:'Bearer '+environment.FMV_LICENSED_FEED_TOKEN,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok){await response.body?.cancel();return {status:response.status===429?'quota_wait':'provider_unavailable',retryAfter:response.headers.get('Retry-After')||null};}
 const reader=response.body?.getReader();if(!reader)throw Error('Missing sales feed body.');let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>300000){await reader.cancel();throw Error('Sales feed exceeds the bounded batch size.')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=Buffer.concat(chunks),parsed=feedSchema.parse(JSON.parse(bytes.toString('utf8'))),result=await importSoldComps(db,parsed.comps,parsed.rightsReference,parsed.rightsExpiresAt);
 await db.execute(sql`UPDATE gcd.fmv_sync_state SET last_completed_at=now(),last_error=NULL,updated_at=now() WHERE id='weekly'`);
 return {status:'completed',...result};
}
