import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ownerAccountId} from '../../../lib/owner';
import {ApiRequestError,privateJson,readObject} from '../../../lib/api-security';
import {gcdSyncStep,getGcdSyncStatus,setGcdSyncPaused,type GcdSyncEnv} from '../../../lib/gcd-sync';

const runtime=()=>env as unknown as GcdSyncEnv;
async function authorized(req:Request,write=false){
 const user=await getChatGPTUser();
 if(user){if(user.userId!==ownerAccountId)throw new ApiRequestError('The central GCD importer belongs to the site owner.',403);if(write&&req.headers.get('origin')!==new URL(req.url).origin)throw new ApiRequestError('Request origin rejected.',403);return;}
 // Sites dispatch authenticates Site service requests before this route. Reuse
 // the existing owner-private service gate READ ONLY; no Metron token is used.
 // Disable the shared gate before making this Site public or adopt a scoped job credential.
 if(runtime().METRON_PRIVATE_SERVICE_ENABLED!=='true'||req.headers.has('origin')||req.headers.get('x-comichuddle-catalog-run')!=='owner-private-service')throw new ApiRequestError('Site owner sign-in required.',401);
}
export async function GET(req:Request){try{await authorized(req);if(new URL(req.url).search)throw new ApiRequestError('Use the GCD status endpoint without query data.',400);return privateJson(await getGcdSyncStatus(getDb(),runtime()))}catch(error){return failure(error)}}
export async function POST(req:Request){try{
 await authorized(req,true);if(new URL(req.url).search)throw new ApiRequestError('Use the GCD action body.',400);
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new ApiRequestError('Send a JSON GCD import action.',415);
 const body=await readObject(req,2000);if(Object.keys(body).some(key=>key!=='action'))throw new ApiRequestError('Unsupported GCD import action field.',400);
 const db=getDb();if(body.action==='daily_step')return privateJson(await gcdSyncStep(db,'daily',runtime()));
 if(body.action==='backfill_step')return privateJson(await gcdSyncStep(db,'backfill',runtime()));
 if(body.action==='pause')return privateJson(await setGcdSyncPaused(db,true));
 if(body.action==='resume')return privateJson(await setGcdSyncPaused(db,false));
 throw new ApiRequestError('Choose daily_step, backfill_step, pause or resume.',400);
 }catch(error){return failure(error)}
}
async function failure(error:unknown){const status=error instanceof ApiRequestError?error.status:503;let retryAfter=0;if(status===429){try{retryAfter=(await getGcdSyncStatus(getDb(),runtime())).retryAfter}catch{}retryAfter=Math.max(1,retryAfter);}return privateJson({error:error instanceof ApiRequestError?error.message:'The GCD importer is unavailable. Retry later.',...(retryAfter?{retryAfter}:{})},status,retryAfter?{'Retry-After':String(retryAfter)}:{});}
