import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ownerAccountId} from '../../../lib/owner';
import {ApiRequestError,privateJson,readObject} from '../../../lib/api-security';
import {getSyncStatus,nightlySyncStep,pauseSync,seedStarter,startSync,syncStep,type MetronSyncEnv} from '../../../lib/metron-sync';

const runtime=()=>env as unknown as MetronSyncEnv;
async function authorized(req:Request,write=false){
 const user=await getChatGPTUser();
 if(user){if(user.userId!==ownerAccountId)throw new ApiRequestError('Catalog setup belongs to the site owner.',403);if(write&&req.headers.get('origin')!==new URL(req.url).origin)throw new ApiRequestError('Request origin rejected.',403);return;}
 // Sites dispatch verifies OAI-Sites-Authorization BEFORE this route. Service
 // access supplies no visitor identity. Enable only while this Site is owner-
 // private; disable before broadening the audience, or add a separate service
 // credential/MCP scope. A browser Origin can never select this service path.
 if(runtime().METRON_PRIVATE_SERVICE_ENABLED!=='true'||req.headers.has('origin')||req.headers.get('x-comichuddle-catalog-run')!=='owner-private-service')throw new ApiRequestError('Owner sign-in required.',401);
}
export async function GET(req:Request){try{await authorized(req);return privateJson(await getSyncStatus(getDb(),runtime()))}catch(error){return failure(error)}}
export async function POST(req:Request){try{
 await authorized(req,true);
 if(new URL(req.url).search)throw new ApiRequestError('Use the catalog action body.',400);
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new ApiRequestError('Send a JSON catalog action.',415);
 const body=await readObject(req,4000);
 if(Object.keys(body).some(k=>!['action','scope'].includes(k)))throw new ApiRequestError('Unsupported catalog action field.',400);
 const db=getDb(),cfg=runtime();
 if(body.action==='seed_starter')return privateJson(await seedStarter(db,cfg));
 if(body.action==='start')return privateJson(await startSync(db,cfg,body.scope));
 if(body.scope!==undefined)throw new ApiRequestError('A scope is only valid when starting an import.',400);
 if(body.action==='step')return privateJson(await syncStep(db,cfg));
 if(body.action==='nightly_step')return privateJson(await nightlySyncStep(db,cfg));
 if(body.action==='pause')return privateJson(await pauseSync(db,cfg));
 throw new ApiRequestError('Choose start, step, nightly_step, pause or seed_starter.',400);
 }catch(error){return failure(error)}
}
async function failure(error:unknown){
 const status=error instanceof ApiRequestError?error.status:503;
 let retryAfter=0;if(status===429){try{retryAfter=(await getSyncStatus(getDb(),runtime())).retryAfter}catch{}retryAfter=Math.max(1,retryAfter);}
 return privateJson({error:error instanceof ApiRequestError?error.message:'The catalog service is unavailable. Retry later.',...(retryAfter?{retryAfter}:{})},status,retryAfter?{'Retry-After':String(retryAfter)}:{});
}
