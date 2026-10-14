import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ownerAccountId} from '../../../lib/owner';
import {ApiRequestError,privateJson,readObject} from '../../../lib/api-security';
import {closeGcdBulk,getGcdBulkStatus,ingestGcdBulkBatch,startGcdBulk} from '../../../lib/gcd-bulk';
import {GCD_BULK_BOUNDS} from '../../../lib/gcd-bulk-format';

async function authorize(req:Request,write=false){
 const user=await getChatGPTUser();if(user){if(user.userId!==ownerAccountId)throw new ApiRequestError('GCD bulk imports belong to the Site owner.',403);if(write&&req.headers.get('origin')!==new URL(req.url).origin)throw new ApiRequestError('Request origin rejected.',403);return}
 if((env as unknown as {METRON_PRIVATE_SERVICE_ENABLED?:string}).METRON_PRIVATE_SERVICE_ENABLED!=='true'||req.headers.has('origin')||req.headers.get('x-comichuddle-catalog-run')!=='owner-private-service')throw new ApiRequestError('Site owner sign-in required.',401);
}
export async function GET(req:Request){try{await authorize(req);const p=new URL(req.url).searchParams;if([...p.keys()].some(k=>k!=='importId')||p.getAll('importId').length!==1)throw new ApiRequestError('Use one exact GCD bulk import ID.',400);return privateJson(await getGcdBulkStatus(getDb(),p.get('importId')||''))}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 await authorize(req,true);if(new URL(req.url).search)throw new ApiRequestError('Use the bulk import JSON body.',400);
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new ApiRequestError('Send a JSON bulk import batch.',415);
 const b=await readObject(req,GCD_BULK_BOUNDS.bodyBytes),keys=b.action==='start'?['action','manifest']:b.action==='batch'?['action','importId','batchIndex','records']:['action','importId'];if(Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k)))throw new ApiRequestError('Unsupported bulk import fields.',400);
 const db=getDb();if(b.action==='start')return privateJson(await startGcdBulk(db,b.manifest));
 if(b.action==='batch')return privateJson(await ingestGcdBulkBatch(db,typeof b.importId==='string'?b.importId:'',b.batchIndex,b.records));
 if(b.action==='finish'||b.action==='cancel')return privateJson(await closeGcdBulk(db,typeof b.importId==='string'?b.importId:'',b.action));
 throw new ApiRequestError('Choose start, batch, finish or cancel.',400);
 }catch(e){return failure(e)}}
function failure(error:unknown){return privateJson({error:error instanceof ApiRequestError?error.message:'The bulk batch could not be saved. Retry the exact checkpoint.'},error instanceof ApiRequestError?error.status:503)}
