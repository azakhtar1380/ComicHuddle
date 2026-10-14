import {eq} from 'drizzle-orm';
import {getDb} from '../../../db';
import {marketValues} from '../../../db/schema';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ownerAccountId} from '../../../lib/owner';
import {marketImportSchema,marketKey,freshValue} from '../../../lib/market-data';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
export async function GET(request:Request){try{
 const issue=new URL(request.url).searchParams.get('issue');if(issue!==null&&(!/^\d{1,10}$/.test(issue)||!Number.isSafeInteger(Number(issue))))return privateJson({error:'Choose a valid directory issue.'},400);
 const all=await getDb().select().from(marketValues).where(issue!==null?eq(marketValues.issueId,Number(issue)):undefined);
 const rows=all.filter(v=>v.licenseReference&&Date.parse(v.rightsExpiresAt)>Date.now()).map(({licenseReference,rightsExpiresAt,...v})=>({...v,fresh:freshValue(v.updatedAt),validUntil:new Date(Math.min(Date.parse(rightsExpiresAt),Date.parse(v.updatedAt)+30*86400000)).toISOString()}));
 return privateJson({currency:'USD',connected:rows.some(v=>v.fresh),rows});
}catch{return privateJson({error:'Valuation data is unavailable. Please retry.'},503)}}
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in required.'},401);
 if(user.userId!==ownerAccountId)return privateJson({error:'Site owner only.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Origin rejected.'},403);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'values:import',30);if(limited)return limited;
 const raw=await readObject(req,200000),parsed=marketImportSchema.safeParse(raw);
 if(!parsed.success)return privateJson({error:'Check values, source URLs, timestamps, ranges, grades and active redistribution permission.'},400);
 const data=parsed.data,keys=data.rows.map(marketKey);if(new Set(keys).size!==keys.length)return privateJson({error:'Duplicate issue, grade, label and printing in this batch.'},400);
 const importedAt=new Date().toISOString();
 const statements=data.rows.map(v=>{const row={...v,id:marketKey(v),licenseReference:data.licenseReference,rightsExpiresAt:data.rightsExpiresAt,importedAt};return db.insert(marketValues).values(row).onConflictDoUpdate({target:marketValues.id,set:row})});
 await db.batch(statements as [typeof statements[number],...typeof statements]);
 return privateJson({saved:data.rows.length,currency:'USD'});
}catch(error){if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);return privateJson({error:'Could not import valuation data. Please retry.'},500)}}
