import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import type {CatalogDb} from './catalog-store';

/**
 * Pluggable AI cover identification. Default provider is 'none' (off).
 *
 *   SCANNER_AI_PROVIDER=gemini   GEMINI_API_KEY=<AI Studio key from a project WITHOUT billing>
 *
 * Only 'gemini' is implemented; 'claude' and 'cloudflare' are reserved names
 * that report "not implemented" until the owner chooses them.
 *
 * Zero-cost design (Gemini free tier):
 *  - global caps only (no per-user throttling): SCANNER_AI_MINUTE_LIMIT and
 *    SCANNER_AI_DAILY_LIMIT, kept below the project's free-tier RPM/RPD;
 *  - any 429 / RESOURCE_EXHAUSTED, billing or permission error disables AI until
 *    the next Pacific-time midnight (when Google resets daily quotas);
 *  - results are cached by the photo's SHA-256; the photo is never stored;
 *  - the image is downscaled to <= 1024 px (JPEG) before sending.
 * When AI is unavailable the scanner silently uses free on-device OCR instead.
 *
 * Gemini REST (docs: https://ai.google.dev/gemini-api/docs/generate-content/structured-output ,
 * https://ai.google.dev/gemini-api/docs/generate-content/image-understanding ):
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * header x-goog-api-key; parts: inline_data{mime_type,data}; JSON output via
 * generationConfig.responseFormat.text{mimeType:"APPLICATION_JSON",schema}.
 */
export type VisionProvider='none'|'gemini'|'claude'|'cloudflare';
export const DEFAULT_GEMINI_MODEL='gemini-3.6-flash';
const GEMINI_API='https://generativelanguage.googleapis.com/v1beta/models/';
const LIMIT_KEY='gemini-ai';

export const identificationSchema=z.object({
 is_comic:z.boolean(),title:z.string().max(200),issue_number:z.string().max(24),publisher:z.string().max(120),
 year:z.number().int().min(1890).max(2100).nullable(),variant_or_printing:z.string().max(200),
 cover_artist:z.string().max(120).nullable(),confidence:z.enum(['high','medium','low']),barcode_digits:z.string().max(24).nullable(),
});
export type CoverIdentification=z.infer<typeof identificationSchema>;
/** JSON Schema sent to the model (nullable fields use a ["type","null"] array as documented). */
export const IDENTIFICATION_JSON_SCHEMA={
 type:'object',
 properties:{
  is_comic:{type:'boolean',description:'True only if the photo shows the front cover of a comic book.'},
  title:{type:'string',description:'Series title as printed in the masthead, without the issue number. Empty if unknown.'},
  issue_number:{type:'string',description:'Issue number as printed (e.g. "300", "1", "0", "1/2"). Empty if not visible.'},
  publisher:{type:'string',description:'Publisher name, e.g. Marvel, DC, Image, Dark Horse, IDW, BOOM! Studios. Empty if unknown.'},
  year:{type:['integer','null'],description:'Cover year if printed or confidently known, else null.'},
  variant_or_printing:{type:'string',description:'Variant cover, printing or edition notes visible on the cover. Empty if none.'},
  cover_artist:{type:['string','null'],description:'Cover artist if credited on the cover, else null.'},
  confidence:{type:'string',enum:['high','medium','low']},
  barcode_digits:{type:['string','null'],description:'Digits printed under a visible UPC/EAN barcode including the add-on, else null.'},
 },
 required:['is_comic','title','issue_number','publisher','year','variant_or_printing','cover_artist','confidence','barcode_digits'],
};
const PROMPT='Identify this comic book from the photo of its cover. Read only what is visible on the cover (masthead/title, issue number, publisher logo, date, price box, variant or printing notes, barcode digits). Do not guess an issue number that is not visible; leave it empty and lower the confidence instead. If the photo is not a comic book cover, set is_comic to false.';

export type VisionEnv=Record<string,string|undefined>;
export function visionConfig(env:VisionEnv=process.env){
 const raw=(env.SCANNER_AI_PROVIDER||'none').trim().toLowerCase();
 const provider:VisionProvider=['gemini','claude','cloudflare'].includes(raw)?raw as VisionProvider:'none';
 const key=typeof env.GEMINI_API_KEY==='string'&&/^[A-Za-z0-9_.-]{20,200}$/.test(env.GEMINI_API_KEY)?env.GEMINI_API_KEY:null;
 const bounded=(value:string|undefined,fallback:number,max:number)=>{const n=Number(value);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback};
 const model=typeof env.SCANNER_AI_MODEL==='string'&&/^[a-z0-9.-]{3,60}$/.test(env.SCANNER_AI_MODEL)?env.SCANNER_AI_MODEL:DEFAULT_GEMINI_MODEL;
 return {provider,ready:provider==='gemini'&&!!key,key,model,
  // Global caps; set them to ~80% of the free-tier RPM/RPD shown for your project in AI Studio.
  dailyLimit:bounded(env.SCANNER_AI_DAILY_LIMIT,100,100000),minuteLimit:bounded(env.SCANNER_AI_MINUTE_LIMIT,8,1000)};
}
export type VisionConfig=ReturnType<typeof visionConfig>;
export type VisionStatus='ok'|'not_comic'|'disabled'|'unavailable';
export type VisionOutcome={status:VisionStatus;reason?:string;identification?:CoverIdentification;provider:VisionProvider;model?:string;cached:boolean};
export type VisionDeps={fetcher?:typeof fetch;env?:VisionEnv;timeoutMs?:number};

/** Seconds until the next midnight in America/Los_Angeles (Google's daily quota reset). */
export function secondsUntilPacificMidnight(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(now).map(part=>[part.type,part.value]));
 const elapsed=(Number(parts.hour)%24)*3600+Number(parts.minute)*60+Number(parts.second);
 return Math.max(60,86400-elapsed);
}
async function disableUntilReset(db:CatalogDb,code:string){
 await db.execute(sql`INSERT INTO ch_web.enrichment_provider_limits(provider,next_request_at,blocked_until,error_code) VALUES(${LIMIT_KEY},now(),now()+${secondsUntilPacificMidnight()}*interval '1 second',${code})
  ON CONFLICT(provider) DO UPDATE SET blocked_until=excluded.blocked_until,error_code=excluded.error_code,updated_at=now()`);
}
/** True while AI may be used: configured, not disabled for the day, and under the global daily cap. */
export async function visionAvailable(db:CatalogDb,config:VisionConfig){
 if(!config.ready)return false;
 try{
  const blocked=await db.execute(sql`SELECT 1 FROM ch_web.enrichment_provider_limits WHERE provider=${LIMIT_KEY} AND blocked_until>now()`);if(blocked.rows.length)return false;
  const day=await db.execute(sql`SELECT requests FROM ch_web.provider_request_windows WHERE provider=${LIMIT_KEY} AND window_kind='day' AND window_start=date_trunc('day',now())`);
  return Number(day.rows[0]?.requests||0)<config.dailyLimit;
 }catch{return false}
}
/** Consumes one request from the global budget. Never exceeds the caps. */
async function takeBudget(db:CatalogDb,config:VisionConfig):Promise<'ok'|'minute'|'day'>{
 const rows=await db.execute(sql`INSERT INTO ch_web.provider_request_windows(provider,window_kind,window_start,requests) VALUES(${LIMIT_KEY},'minute',date_trunc('minute',now()),1),(${LIMIT_KEY},'day',date_trunc('day',now()),1)
  ON CONFLICT(provider,window_kind,window_start) DO UPDATE SET requests=provider_request_windows.requests+1 RETURNING window_kind,requests`);
 const count=(kind:string)=>Number(rows.rows.find(row=>row.window_kind===kind)?.requests||0);
 if(count('day')>config.dailyLimit)return 'day';
 if(count('minute')>config.minuteLimit)return 'minute';
 return 'ok';
}
/** EXIF-rotate, downscale to <= 1024 px, JPEG. Returns base64 for the request only. */
export async function prepareVisionImage(bytes:Buffer){
 const jpeg=await sharp(bytes,{limitInputPixels:50_000_000,failOn:'error'}).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
 return jpeg.toString('base64');
}

export type GeminiCall={status:'ok';text:string}|{status:'quota'|'billing'|'blocked'|'error'|'bad_request'};
/** One generateContent request (exported for diagnostics/tests). */
export async function callGemini(config:VisionConfig,image:string,legacyFormat:boolean,deps:VisionDeps):Promise<GeminiCall>{
 const generationConfig=legacyFormat?{responseMimeType:'application/json',responseJsonSchema:IDENTIFICATION_JSON_SCHEMA}:{responseFormat:{text:{mimeType:'APPLICATION_JSON',schema:IDENTIFICATION_JSON_SCHEMA}}};
 const body={contents:[{role:'user',parts:[{inline_data:{mime_type:'image/jpeg',data:image}},{text:PROMPT}]}],generationConfig};
 let response:Response;
 try{response=await (deps.fetcher||fetch)(GEMINI_API+encodeURIComponent(config.model)+':generateContent',{method:'POST',headers:{'x-goog-api-key':config.key!,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(deps.timeoutMs||20000),cache:'no-store',redirect:'error'})}
 catch{return {status:'error'}}
 let payload:Record<string,unknown>={};try{payload=await response.json()}catch{}
 const error=(payload.error&&typeof payload.error==='object'?payload.error:{}) as {status?:string;code?:number};
 // Structured error codes (google.rpc.Code names), not message text.
 if(response.status===429||error.status==='RESOURCE_EXHAUSTED')return {status:'quota'};
 if(response.status===402||response.status===403||error.status==='PERMISSION_DENIED'||error.status==='FAILED_PRECONDITION')return {status:'billing'};
 if(response.status===400)return {status:'bad_request'};
 if(!response.ok)return {status:'error'};
 const feedback=payload.promptFeedback as {blockReason?:string}|undefined;if(feedback?.blockReason)return {status:'blocked'};
 const candidate=(Array.isArray(payload.candidates)?payload.candidates[0]:null) as {content?:{parts?:{text?:string}[]};finishReason?:string}|null;
 if(!candidate)return {status:'error'};
 if(candidate.finishReason&&!['STOP','MAX_TOKENS'].includes(candidate.finishReason))return {status:'blocked'};
 const text=(candidate.content?.parts||[]).map(part=>typeof part.text==='string'?part.text:'').join('');
 return text?{status:'ok',text}:{status:'error'};
}

export async function identifyCover(db:CatalogDb,bytes:Buffer,deps:VisionDeps={}):Promise<VisionOutcome>{
 const config=visionConfig(deps.env);
 if(config.provider==='none')return {status:'disabled',reason:'provider_none',provider:'none',cached:false};
 if(config.provider!=='gemini')return {status:'disabled',reason:'provider_not_implemented',provider:config.provider,cached:false};
 if(!config.ready)return {status:'disabled',reason:'missing_api_key',provider:'gemini',cached:false};
 const hash=createHash('sha256').update(bytes).digest('hex'),base={provider:'gemini' as const,model:config.model};
 try{
  const hit=(await db.execute(sql`SELECT result FROM ch_web.cover_vision_cache WHERE image_sha256=${hash} AND expires_at>now()`)).rows[0];
  if(hit){const parsed=identificationSchema.safeParse(hit.result);if(parsed.success)return {...base,status:parsed.data.is_comic?'ok':'not_comic',identification:parsed.data,cached:true}}
  if(!await visionAvailable(db,config))return {...base,status:'unavailable',reason:'daily_cap_or_disabled',cached:false};
 }catch{return {...base,status:'unavailable',reason:'storage_unavailable',cached:false}}
 let image:string;try{image=await prepareVisionImage(bytes)}catch{return {...base,status:'unavailable',reason:'unreadable_image',cached:false}}
 for(const legacy of [false,true]){
  const budget=await takeBudget(db,config);
  if(budget==='day'){await disableUntilReset(db,'daily_cap_reached');return {...base,status:'unavailable',reason:'daily_cap',cached:false}}
  if(budget==='minute')return {...base,status:'unavailable',reason:'minute_cap',cached:false};
  const call=await callGemini(config,image,legacy,deps);
  // A 400 on the current structured-output field: retry once with the older documented fields.
  if(call.status==='bad_request'&&!legacy)continue;
  if(call.status==='quota'){await disableUntilReset(db,'provider_quota');return {...base,status:'unavailable',reason:'quota',cached:false}}
  if(call.status==='billing'){await disableUntilReset(db,'provider_access_or_billing');return {...base,status:'unavailable',reason:'access',cached:false}}
  if(call.status!=='ok')return {...base,status:'unavailable',reason:call.status,cached:false};
  let parsed;try{parsed=identificationSchema.safeParse(JSON.parse(call.text))}catch{parsed=null}
  if(!parsed?.success)return {...base,status:'unavailable',reason:'malformed_response',cached:false};
  const identification=parsed.data;
  await db.execute(sql`INSERT INTO ch_web.cover_vision_cache(image_sha256,provider,model,result,expires_at) VALUES(${hash},'gemini',${config.model},${JSON.stringify(identification)}::jsonb,now()+interval '30 days')
   ON CONFLICT(image_sha256) DO UPDATE SET result=excluded.result,model=excluded.model,created_at=now(),expires_at=excluded.expires_at`).catch(()=>undefined);
  return {...base,status:identification.is_comic?'ok':'not_comic',identification,cached:false};
 }
 return {...base,status:'unavailable',reason:'bad_request',cached:false};
}
