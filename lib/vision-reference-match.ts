import {sql} from 'drizzle-orm';
import sharp from 'sharp';
import type {CatalogDb} from './catalog-store';
import {approvedSourceFetch} from './cover-source-fetch';
import {coverStorageStatus} from './cover-cache';
import {structuredAi} from './enrichment-ai';
import type {Issue} from './catalog';
/** Reference artwork reaches an AI provider only with explicit AI processing
 * permission. A successful artwork comparison is still not authentication. */
export async function compareApprovedVisionReferences(db:CatalogDb,photoData:string,candidates:Issue[],remainingMs:number){
 const storage=coverStorageStatus();if(!storage.ready||candidates.length<2||remainingMs<18000)return null;
 const found=await db.execute(sql`SELECT DISTINCT ON(c.issue_id) c.issue_id,c.renditions FROM ch_web.cover_cache c JOIN ch_web.source_permissions p ON p.provider=c.source_provider WHERE c.issue_id IN (${sql.join(candidates.slice(0,3).map(issue=>sql`${issue.id}`),sql`,`)}) AND c.status='CACHED' AND p.enabled AND p.access_allowed AND p.ai_allowed AND p.display_allowed AND p.cache_allowed AND p.revoked_at IS NULL AND p.valid_until>now() AND c.permission_expires_at>now() AND c.permission_reference=p.evidence_reference ORDER BY c.issue_id,c.updated_at DESC`);
 if(found.rows.length<2)return null;
 const refs=await Promise.all(found.rows.map(async row=>{try{const key=(row.renditions as {dense?:{key?:string}}).dense?.key;if(!key||!/^comic-covers\/[A-Za-z0-9/%_.-]+$/.test(key)||key.includes('..'))return null;const result=await approvedSourceFetch(storage.base+'/'+key,[new URL(storage.base!).hostname],{maxBytes:600000,timeoutMs:5000});if(!/^image\/(webp|jpeg|png)/.test(result.headers['content-type']||''))return null;const bytes=await sharp(result.bytes,{limitInputPixels:1000000,animated:false}).resize({width:500,height:700,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();return {id:Number(row.issue_id),data:'data:image/jpeg;base64,'+bytes.toString('base64')}}catch{return null}}));
 const usable=refs.filter((ref):ref is {id:number;data:string}=>!!ref);if(usable.length<2)return null;
 const schema={type:'object',properties:{candidateId:{type:['integer','null']},result:{type:'string',enum:['consistent','ambiguous','different']},requiresIndicia:{type:'boolean'}},required:['candidateId','result','requiresIndicia'],additionalProperties:false};
 const response=await structuredAi<{candidateId:number|null;result:string;requiresIndicia:boolean}>(db,'scanner',schema,'Compare the first user photograph only against the supplied approved catalog reference images, in their listed order. Return only a supplied candidate ID or null. Cover similarity cannot establish printing, authenticity, condition or certification. Visually identical originals and facsimiles remain ambiguous; require indicia when appropriate. Never overrule a visible facsimile or printing clue.',{references:usable.map(ref=>{const issue=candidates.find(c=>c.id===ref.id)!;return {candidateId:ref.id,title:issue.title,number:issue.number,year:issue.year,variant:issue.variant}})},[photoData,...usable.map(ref=>ref.data)],Math.min(15000,remainingMs-6000));
 if(!['consistent','ambiguous','different'].includes(response.value.result)||typeof response.value.requiresIndicia!=='boolean'||response.value.candidateId!==null&&!usable.some(ref=>ref.id===response.value.candidateId))return null;
 return response.value;
}
