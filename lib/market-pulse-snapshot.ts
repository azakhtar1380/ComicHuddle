import {createHmac,randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {catalogIssuesById,type CatalogDb} from './catalog-store';
import {catalogSearchDto} from './catalog-search';
import {listingDirectoryId} from './shared-catalog';
import {ownerAccountId} from './owner';
import {evaluateCommercePolicy,type CommerceState} from './commerce-policy';
import {enqueueEnrichment,finishEnrichment,type EnrichmentJob} from './enrichment-jobs';
import {structuredAi} from './enrichment-ai';
import type {Issue} from './catalog';
export type PulseItem={metricId:string;issue:Issue;metric:'copies_sold'|'grail_additions'|'qualified_views'|'notable_sale'|'spotlight';value:number|null;priorValue:number|null;changePercent:number|null;orderCount?:number;independentBuyers?:number;amountCents?:number;soldAt?:string;basis:string};
export type PulseSnapshot={id:string;start:string;end:string;timezone:'America/Chicago';updatedAt:string;topSold:PulseItem[];mostWanted:PulseItem[];attention:PulseItem[];notable:PulseItem[];spotlight:PulseItem[];aiStatus:string;aiSummary:{text:string;metricIds:string[]}|null};
export function activityChange(current:number,prior:number){return prior===0?null:Math.round((current-prior)/prior*1000)/10}
type Sale={id:string;buyer:string;seller:string;at:string;amount:number;items:{issueId:number;condition:unknown}[]};
/** No ended auction, manual sold flag or test checkout qualifies as a sale. */
export function qualifyingPlatformSale(row:{id:string;sandbox:number;buyer_user_id:string;seller_user_id:string;state:string;snapshot:string},asOf:number):Sale|null{
 try{if(row.sandbox!==0||row.buyer_user_id===row.seller_user_id||[row.buyer_user_id,row.seller_user_id].includes(ownerAccountId))return null;
  const state=JSON.parse(row.state) as CommerceState,snapshot=JSON.parse(row.snapshot),decision=evaluateCommercePolicy(state,new Date(asOf).toISOString());
  if(decision.status!=='transferred'||!state.order.paidAt||!state.order.paymentIntentId||!state.order.chargeId||!state.shipment.deliveredAt||state.issue?.open||state.dispute!=='none'||state.refundReason||!state.financial?.confirmedAt||state.financial.kind!=='transfer'||!Array.isArray(snapshot.items)||snapshot.currency!=='USD')return null;
  const at=state.financial.confirmedAt;if(Date.parse(at)>asOf)return null;
  const items=snapshot.items.flatMap((item:Parameters<typeof listingDirectoryId>[0]&{condition?:unknown})=>{const id=listingDirectoryId(item);return id===null?[]:[{issueId:id,condition:item.condition||null}]});if(items.length!==snapshot.items.length||!Number.isSafeInteger(snapshot.itemAmountCents))return null;
  return {id:row.id,buyer:row.buyer_user_id,seller:row.seller_user_id,at,amount:snapshot.itemAmountCents,items};
 }catch{return null}
}
export async function recordCollectorActivity(db:CatalogDb,profile:{id:string;userId:string;createdAt:string;visible:number;moderated:number},ids:number[],kind:'grail'|'view'){
 if(profile.userId===ownerAccountId||!profile.visible||profile.moderated||Date.now()-Date.parse(profile.createdAt)<86400000||!process.env.BETTER_AUTH_SECRET)return;
 const unique=[...new Set(ids)].slice(0,kind==='grail'?6:20);if(!unique.length)return;
 const actor=createHmac('sha256',process.env.BETTER_AUTH_SECRET).update('collector-metrics:'+profile.userId).digest('hex');
 await db.execute(sql`INSERT INTO ch_web.collector_activity(id,actor_key,issue_id,kind) SELECT v.id::uuid,v.actor_key,v.issue_id::bigint,v.kind FROM (VALUES ${sql.join(unique.map(id=>sql`(${randomUUID()},${actor},${id},${kind})`),sql`, `)})v(id,actor_key,issue_id,kind) WHERE (SELECT count(*) FROM ch_web.collector_activity WHERE actor_key=${actor} AND observed_day=CURRENT_DATE)<100 ON CONFLICT(actor_key,issue_id,kind,observed_day) DO NOTHING`);
}
export async function readMarketPulseSnapshot(db:CatalogDb):Promise<PulseSnapshot>{
 const end=new Date(Math.floor(Date.now()/3600000)*3600000),start=new Date(end.getTime()-7*86400000),prior=new Date(start.getTime()-7*86400000),id='platform:'+end.toISOString();
 const cached=await db.execute(sql`SELECT snapshot,ai_summary,ai_status FROM ch_web.market_pulse_snapshots WHERE id=${id} AND expires_at>now()`);if(cached.rows[0])return {...cached.rows[0].snapshot as PulseSnapshot,aiSummary:cached.rows[0].ai_summary as PulseSnapshot['aiSummary'],aiStatus:String(cached.rows[0].ai_status)};
 const [activity,orders]=await Promise.all([
  db.execute(sql`SELECT issue_id,kind,count(DISTINCT actor_key) FILTER(WHERE observed_at>=${start.toISOString()}::timestamptz)::int AS current,count(DISTINCT actor_key) FILTER(WHERE observed_at<${start.toISOString()}::timestamptz)::int AS prior FROM ch_web.collector_activity WHERE observed_at>=${prior.toISOString()}::timestamptz AND observed_at<${end.toISOString()}::timestamptz GROUP BY issue_id,kind ORDER BY current DESC,issue_id LIMIT 100`),
  db.execute(sql`SELECT id,sandbox,buyer_user_id,seller_user_id,state,snapshot FROM ch_web.commerce_orders o WHERE sandbox=0 AND updated_at>=${start.toISOString()} AND NOT EXISTS(SELECT 1 FROM ch_web.account_restrictions r WHERE r.user_id IN(o.buyer_user_id,o.seller_user_id) AND r.scope='account') LIMIT 1000`)
 ]);
 const sales=orders.rows.map(row=>qualifyingPlatformSale(row as unknown as Parameters<typeof qualifyingPlatformSale>[0],end.getTime())).filter((row):row is Sale=>!!row).filter(row=>Date.parse(row.at)>=start.getTime());
 // Repeated counterparties are excluded conservatively. No inferred economic
 // independence is sent to AI or represented as verified identity.
 const eligible=sales.filter(sale=>sales.filter(other=>other.buyer===sale.buyer&&other.seller===sale.seller).length<=2),sold=new Map<number,{copies:number;orders:Set<string>;buyers:Set<string>}>();
 for(const sale of eligible)for(const copy of sale.items){const row=sold.get(copy.issueId)||{copies:0,orders:new Set(),buyers:new Set()};row.copies++;row.orders.add(sale.id);row.buyers.add(sale.buyer);sold.set(copy.issueId,row)}
 const candidates=[...new Set([...activity.rows.map(row=>Number(row.issue_id)),...sold.keys(),...eligible.flatMap(s=>s.items.map(i=>i.issueId)),24,25,26,27,28,29])],records=new Map<number,Issue>();for(let i=0;i<candidates.length;i+=100)for(const issue of await catalogIssuesById(db,candidates.slice(i,i+100)))records.set(issue.id,issue);
 const topSold=[...sold].sort((a,b)=>b[1].copies-a[1].copies||a[0]-b[0]).slice(0,10).flatMap(([issueId,row])=>{const issue=records.get(issueId);return issue?[{metricId:'copies:'+issueId,issue:catalogSearchDto(issue),metric:'copies_sold' as const,value:row.copies,priorValue:null,changePercent:null,orderCount:row.orders.size,independentBuyers:row.buyers.size,basis:'Qualifying physical copies sold on ComicHuddle. Bundle revenue is not divided into individual prices.'}]:[]});
 const interest=(kind:string)=>activity.rows.filter(row=>row.kind===kind&&Number(row.current)>0).slice(0,10).flatMap(row=>{const issue=records.get(Number(row.issue_id)),current=Number(row.current),previous=Number(row.prior);return issue?[{metricId:kind+':'+row.issue_id,issue:catalogSearchDto(issue),metric:kind==='grail'?'grail_additions' as const:'qualified_views' as const,value:current,priorValue:previous,changePercent:current>=3&&previous>=3?activityChange(current,previous):null,basis:kind==='grail'?'Collectors added to grails. Distinct eligible accounts, not sales.':'Qualified views by distinct eligible accounts. Attention, not price growth.'}]:[]});
 const notable=eligible.filter(s=>s.items.length===1).sort((a,b)=>b.amount-a.amount).slice(0,6).flatMap(sale=>{const issue=records.get(sale.items[0].issueId);return issue?[{metricId:'sale:'+sale.id,issue:catalogSearchDto(issue),metric:'notable_sale' as const,value:null,priorValue:null,changePercent:null,amountCents:sale.amount,soldAt:sale.at,basis:'Confirmed single-book item amount, excluding shipping and tax. No private party details.'}]:[]});
 const spotlight=[24,25,26,27,28,29].flatMap(issueId=>{const issue=records.get(issueId);return issue?[{metricId:'catalog:'+issueId,issue:catalogSearchDto(issue),metric:'spotlight' as const,value:null,priorValue:null,changePercent:null,basis:issue.note||'Discover this catalog edition. This is not a sales ranking.'}]:[]});
 const snapshot:PulseSnapshot={id,start:start.toISOString(),end:end.toISOString(),timezone:'America/Chicago',updatedAt:new Date().toISOString(),topSold,mostWanted:interest('grail'),attention:interest('view'),notable,spotlight,aiStatus:'queued',aiSummary:null};
 await db.execute(sql`INSERT INTO ch_web.market_pulse_snapshots(id,snapshot,expires_at,ai_status) VALUES(${id},${JSON.stringify(snapshot)}::jsonb,now()+interval '15 minutes','queued') ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,expires_at=excluded.expires_at,ai_status='queued',ai_summary=NULL`);
 await enqueueEnrichment(db,'pulse',id,{snapshotId:id});return snapshot;
}
export async function processPulseJob(db:CatalogDb,job:EnrichmentJob){
 const id=String(job.payload.snapshotId),found=await db.execute(sql`SELECT snapshot FROM ch_web.market_pulse_snapshots WHERE id=${id}`),snapshot=found.rows[0]?.snapshot as PulseSnapshot|undefined;if(!snapshot){await finishEnrichment(db,job,'DONE');return}
 const items=[...snapshot.topSold,...snapshot.mostWanted,...snapshot.attention,...snapshot.notable,...snapshot.spotlight].slice(0,20);
 try{const schema={type:'object',properties:{text:{type:'string'},metricIds:{type:'array',items:{type:'string'}}},required:['text','metricIds'],additionalProperties:false};
  const result=await structuredAi<{text:string;metricIds:string[]}>(db,'pulse',schema,'Summarize only this measured ComicHuddle snapshot. Cite supplied metric IDs. A catalog spotlight is discovery, never sales or a price trend. Do not infer movies, scarcity, investment returns or causes. Use no numeric characters; displayed numbers come from validated metrics, not your prose. Never claim the whole market is measured.',{period:{start:snapshot.start,end:snapshot.end,timezone:snapshot.timezone},metrics:items.map(item=>({id:item.metricId,title:item.issue.title,metric:item.metric,value:item.value,basis:item.basis}))});
  if(typeof result.value.text!=='string'||result.value.text.length>500||/[0-9]|movie|announcement|scarce|guarantee|investment|surge|whole market/i.test(result.value.text)||!Array.isArray(result.value.metricIds)||!result.value.metricIds.length||result.value.metricIds.some(key=>!items.some(item=>item.metricId===key)))throw Error('Unsubstantiated insight');
  await db.execute(sql`UPDATE ch_web.market_pulse_snapshots SET ai_summary=${JSON.stringify(result.value)}::jsonb,ai_status='available' WHERE id=${id}`);
 }catch{await db.execute(sql`UPDATE ch_web.market_pulse_snapshots SET ai_summary=NULL,ai_status='unavailable' WHERE id=${id}`)}await finishEnrichment(db,job,'DONE');
}
