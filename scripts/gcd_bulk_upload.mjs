// node --experimental-vm-modules scripts/gcd_bulk_upload.mjs --csv issues.csv
// --manifest issues.manifest.json --action upload --max-batches 100
// Credential: COMICHUDDLE_SERVICE_TOKEN. No supplier requests or token logging.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {format,argsFor,csvRecords,preflightCsv} from './gcd_bulk_codec.mjs';

const SITE='https://comichuddle.aztooeasy.chatgpt.site';
export function createBulkClient(token,fetcher=fetch,site=SITE){
 if(site!==SITE||!token||token.length>8192||/[\x00-\x1f\x7f]/.test(token))throw Error('Use the exact private Site and its service credential');
 return async(body,id)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);if(payload&&Buffer.byteLength(payload)>format.GCD_BULK_BOUNDS.bodyBytes)throw Error('Bulk request exceeds its bounded transport size');
  const response=await fetcher(SITE+'/api/gcd-bulk'+(body===undefined?'?importId='+id:''),{method:body===undefined?'GET':'POST',headers:{Accept:'application/json','OAI-Sites-Authorization':'Bearer '+token,'X-ComicHuddle-Catalog-Run':'owner-private-service',...(body===undefined?{}:{'Content-Type':'application/json'})},body:payload,redirect:'manual',signal:AbortSignal.timeout(55000)});
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error('Private Site returned a non-JSON response');
  if(Number(response.headers.get('content-length'))>65536){await response.body?.cancel();throw Error('Private Site status exceeds the response limit')}
  const reader=response.body?.getReader();let bytes=0,parts=[];if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){await reader.cancel();throw Error('Private Site status exceeds the response limit')}parts.push(value)}}finally{reader.releaseLock()}}
  const data=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid private Site status');return {status:response.status,data};
 };
}
const summary=(s,outcome,batches)=>({outcome,batches,importId:s.importId,stage:s.stage,acceptedRecords:s.acceptedRecords,writtenRecords:s.writtenRecords,retainedNewerRecords:s.retainedNewerRecords,nextBatch:s.nextBatch,historicalCoverageComplete:false});
export async function uploadGcdCsv(options,client,shouldStop=()=>false){
 const allowed=['csv','manifest','action','max-batches'];if(Object.keys(options).some(k=>!allowed.includes(k))||!options.csv||!options.manifest||!['upload','status','cancel'].includes(options.action||'upload'))throw Error('Supply CSV, manifest and upload/status/cancel action');
 const manifestBytes=await readFile(options.manifest);if(manifestBytes.length>8000)throw Error('Manifest exceeds its size limit');const manifest=format.validateGcdBulkManifest(JSON.parse(manifestBytes.toString('utf8'))),id=await format.sha256(format.canonicalJson(manifest)),action=options.action||'upload';
 if(action!=='upload'){const r=await client(action==='cancel'?{action:'cancel',importId:id}:undefined,id);if(r.status!==200)throw Error('Private Site action failed with HTTP '+r.status);return summary(r.data,action,0)}
 await preflightCsv(options.csv,manifest);const max=Number(options['max-batches']||100);if(!Number.isSafeInteger(max)||max<1||max>1000000)throw Error('Use a bounded positive maximum batch count');
 let r=await client({action:'start',manifest});if(r.status!==200)throw Error('Private Site start failed with HTTP '+r.status);let state=r.data;if(state.importId!==id||!Number.isSafeInteger(state.nextBatch)||state.nextBatch<0)throw Error('Private Site returned a mismatched import cursor');if(state.stage==='COMPLETED')return summary(state,'already-completed',0);if(state.stage!=='OPEN')throw Error('This import is closed');
 let batch=[],index=0,sent=0;
 async function send(){
  if(index<state.nextBatch){index++;batch=[];return}
  r=await client({action:'batch',importId:id,batchIndex:index,records:batch});if(r.status!==200)throw Error('Private Site batch failed with HTTP '+r.status+'; accepted checkpoints remain resumable');if(r.data.importId!==id||r.data.nextBatch!==index+1)throw Error('Private Site returned a mismatched batch receipt');state=r.data;index++;sent++;batch=[];
 }
 for await(const record of csvRecords(options.csv,manifest)){
  if(shouldStop())return summary(state,'interrupted-checkpoint-retained',sent);batch.push(record);if(batch.length===format.GCD_BULK_BOUNDS.records){if(sent>=max)return summary(state,'run-budget-checkpoint-retained',sent);await send()}
 }
 if(batch.length){if(sent>=max)return summary(state,'run-budget-checkpoint-retained',sent);await send()}
 if(shouldStop())return summary(state,'interrupted-checkpoint-retained',sent);r=await client({action:'finish',importId:id});if(r.status!==200)throw Error('Private Site completion did not verify count/checksum; accepted data remains checkpointed');return summary(r.data,'declared-export-completed',sent);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){let stopped=false;process.once('SIGINT',()=>{stopped=true});try{console.log(JSON.stringify(await uploadGcdCsv(argsFor(process.argv.slice(2)),createBulkClient(process.env.COMICHUDDLE_SERVICE_TOKEN||''),()=>stopped)));if(stopped)process.exitCode=130}catch{console.error(JSON.stringify({outcome:'bulk-upload-failed-checkpoint-retained'}));process.exitCode=1}}
