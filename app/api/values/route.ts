import {eq,sql} from 'drizzle-orm';
import {getDb} from '../../../db';
import {catalogIssue} from '../../../lib/catalog-store';
import {importSoldComps,soldCompSchema} from '../../../lib/sold-comps';
import {z} from 'zod';
import {marketValues} from '../../../db/schema';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ownerAccountId} from '../../../lib/owner';
import {marketImportSchema,marketKey,freshValue} from '../../../lib/market-data';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
export async function GET(request:Request){try{
 const issue=new URL(request.url).searchParams.get('issue');if(issue!==null&&(!/^\d{1,10}$/.test(issue)||!Number.isSafeInteger(Number(issue))))return privateJson({error:'Choose a valid directory issue.'},400);
 const db=getDb();
 const sourced=await db.execute(sql`SELECT issue_id,mode,grade,label,printing,fmv_price,low_price,high_price,last_updated,sample_size,window_days,source_name,source_url,valid_until FROM gcd.fmv_records WHERE ${issue!==null?sql`issue_id=${Number(issue)}`:sql`true`} AND valid_until>now() ORDER BY last_updated DESC LIMIT 1000`);
 const estimates=sourced.rows.map(v=>({id:[v.issue_id,v.mode,v.grade,v.printing].join('|'),issueId:Number(v.issue_id),mode:v.mode,grade:v.grade,label:v.label,printing:v.printing,fmv:Number(v.fmv_price),low:Number(v.low_price),high:Number(v.high_price),sales:Number(v.sample_size),windowDays:Number(v.window_days),updatedAt:new Date(String(v.last_updated)).toISOString(),sourceName:v.source_name,sourceUrl:v.source_url,fresh:true,validUntil:new Date(String(v.valid_until)).toISOString()}));
 const all=await db.select().from(marketValues).where(issue!==null?eq(marketValues.issueId,Number(issue)):undefined);
 const licensed=all.filter(v=>v.licenseReference&&Date.parse(v.rightsExpiresAt)>Date.now()).map(({licenseReference,rightsExpiresAt,...v})=>({...v,fresh:freshValue(v.updatedAt),validUntil:new Date(Math.min(Date.parse(rightsExpiresAt),Date.parse(v.updatedAt)+30*86400000)).toISOString()}));
 const rows=[...estimates,...licensed];return privateJson({currency:'USD',connected:rows.some(v=>v.fresh),rows});
}catch{return privateJson({error:'Valuation data is unavailable. Please retry.'},503)}}
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in required.'},401);
 if(user.userId!==ownerAccountId)return privateJson({error:'Site owner only.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Origin rejected.'},403);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'values:import',30);if(limited)return limited;
 const raw=await readObject(req,200000);
 if(raw.action==='import_sold_comps'){const input=z.object({action:z.literal('import_sold_comps'),rightsConfirmed:z.literal(true),rightsReference:z.string().min(5).max(300),rightsExpiresAt:z.string().datetime(),comps:z.array(soldCompSchema).min(1).max(300)}).strict().safeParse(raw);if(!input.success)return privateJson({error:'Use exact issue identities, USD completed prices and documented redistribution permission.'},400);return privateJson(await importSoldComps(db,input.data.comps,input.data.rightsReference,input.data.rightsExpiresAt))}
 const parsed=marketImportSchema.safeParse(raw);
 if(!parsed.success)return privateJson({error:'Check values, source URLs, timestamps, ranges, grades and active redistribution permission.'},400);
 const data=parsed.data;for(const id of [...new Set(data.rows.map(row=>row.issueId))])if(!await catalogIssue(db,id))return privateJson({error:'Select a real directory issue for each valuation.'},400);const keys=data.rows.map(marketKey);if(new Set(keys).size!==keys.length)return privateJson({error:'Duplicate issue, grade, label and printing in this batch.'},400);
 const importedAt=new Date().toISOString();
 const statements=data.rows.map(v=>{const row={...v,id:marketKey(v),licenseReference:data.licenseReference,rightsExpiresAt:data.rightsExpiresAt,importedAt};return db.insert(marketValues).values(row).onConflictDoUpdate({target:marketValues.id,set:row})});
 await db.batch(statements as [typeof statements[number],...typeof statements]);
 return privateJson({saved:data.rows.length,currency:'USD'});
}catch(error){if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);return privateJson({error:'Could not import valuation data. Please retry.'},500)}}
