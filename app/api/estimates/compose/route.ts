import {z} from 'zod';
import {after} from 'next/server';
import {drainEnrichment} from '../../../../lib/enrichment-worker';
import {getDb} from '../../../../db';
import {combinedListingEstimate,estimateRequestSchema} from '../../../../lib/estimated-fmv';
import {catalogIssuesById} from '../../../../lib/catalog-store';
import {issueIdentity} from '../../../../lib/shared-catalog';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {readObject,privateJson} from '../../../../lib/api-security';
import type {ListingItem} from '../../../../lib/community';
export const runtime='nodejs';
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Open the listing builder from ComicHuddle.'},403);
 if(!await getChatGPTUser())return privateJson({error:'Sign in to value a listing draft.'},401);
 const input=z.object({rows:z.array(z.object({id:z.string().max(80),issueId:z.number().int().min(0).nullable(),copyIds:z.array(z.string().max(80)).min(1).max(1000),grade:z.string().max(80),condition:estimateRequestSchema.shape.condition})).max(1000)}).strict().parse(await readObject(request,300000));
 if(input.rows.reduce((sum,r)=>sum+r.copyIds.length,0)>1000)return privateJson({error:'A listing supports up to 1,000 copies.'},400);
 const copyIds=input.rows.flatMap(row=>row.copyIds);if(new Set(copyIds).size!==copyIds.length)return privateJson({error:'Each physical copy needs a distinct identifier.'},400);
 const db=getDb(),ids=[...new Set(input.rows.flatMap(r=>r.issueId===null?[]:[r.issueId]))],records=new Map();for(let i=0;i<ids.length;i+=100)for(const issue of await catalogIssuesById(db,ids.slice(i,i+100)))records.set(issue.id,issue);
 const items:ListingItem[]=input.rows.flatMap(row=>{const issue=row.issueId===null?null:records.get(row.issueId);return row.copyIds.map(id=>({id,bookId:id,title:issue?.title||'Unmatched comic',issue:issue?'#'+issue.number:'',grade:row.grade,...(issue?issueIdentity(issue):{}),...(row.condition?{condition:row.condition as ListingItem['condition']}:{})}))});
 const estimate=await combinedListingEstimate(db,items,true);after(async()=>{await drainEnrichment(db,['valuation'],3,45000)});return privateJson({estimate});
 }catch{return privateJson({error:'The draft estimate could not load. Your selection can still be saved.'},503)}}
