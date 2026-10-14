import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {careProviders,careReviews,careJobs,careEvents,profiles,collections,media,threads} from '../../../db/schema';
import {and,eq,or,desc,inArray,count,sql,type SQL} from 'drizzle-orm';
import {z} from 'zod';
import {emptyVault,vaultSchema} from '../../../lib/vault';
import {blocked} from '../../../lib/conversations';
import {rankProviders,canCareTransition,careIntakeForViewer,type Provider,type CareJob} from '../../../lib/pressing';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readObject,chunks,blockedPeerIds} from '../../../lib/api-security';
import {previewRulesVersion} from '../../../lib/community';
import {conditionalGuard,operationGuardFailed} from '../../../lib/operation-guard';

type Db=ReturnType<typeof getDb>;
type P=typeof profiles.$inferSelect;
type ProviderRow=typeof careProviders.$inferSelect;
type JobRow=typeof careJobs.$inferSelect;
const json=privateJson;
const now=()=>new Date().toISOString();
const id=z.string().uuid();
const short=(n:number)=>z.string().trim().min(1).max(n);
const services=z.array(z.enum(['pressing','dry_cleaning','assessment','cgc'])).min(1).max(4).refine(v=>new Set(v).size===v.length);
const cents=z.number().int().min(0).max(100000000);
const web=z.string().max(500).refine(s=>!s||(()=>{try{const url=new URL(s);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password}catch{return false}})(),'Use a public HTTPS website address without credentials.');
async function ownedPhotos(db:Db,userId:string,ids:string[]){if(!ids.length)return true;const rows=await db.select().from(media).where(inArray(media.id,[...new Set(ids)]));return rows.length===new Set(ids).size&&rows.every(r=>r.userId===userId)}
type ProviderStats={rating:number|null;quality:number|null;communication:number|null;timeliness:number|null;reviewCount:number;completedReviewCount:number};
async function providerStats(db:Db,ids:string[]){const stats=new Map<string,ProviderStats>();for(const batch of chunks([...new Set(ids)])){const rows=await db.select({providerId:careReviews.providerId,rating:sql<number|null>`AVG(${careReviews.rating})`,quality:sql<number|null>`AVG(${careReviews.quality})`,communication:sql<number|null>`AVG(${careReviews.communication})`,timeliness:sql<number|null>`AVG(${careReviews.timeliness})`,reviewCount:count(),completedReviewCount:sql<number>`SUM(CASE WHEN ${careReviews.jobId} IS NOT NULL THEN 1 ELSE 0 END)`}).from(careReviews).where(inArray(careReviews.providerId,batch)).groupBy(careReviews.providerId);for(const {providerId,...fields} of rows)stats.set(providerId,fields)}return stats}
async function carePeople(db:Db,ids:string[]){const people=new Map<string,P>();for(const batch of chunks([...new Set(ids)])){for(const p of await db.select().from(profiles).where(inArray(profiles.id,batch)))people.set(p.id,p)}return people}
async function providerDto(db:Db,row:ProviderRow,own=false,known?:{profile:P|undefined;stats:ProviderStats|undefined}):Promise<Provider>{
 const p=known?known.profile:(await db.select().from(profiles).where(eq(profiles.id,row.profileId)))[0];
 const stats=known?known.stats:(await providerStats(db,[row.id])).get(row.id);
 const {shippingAddress,shippingNotes,moderated,...publicRow}=row;
 return {...publicRow,services:JSON.parse(row.services),prices:JSON.parse(row.prices),portfolio:JSON.parse(row.portfolio),mailIn:!!row.mailIn,dropoff:!!row.dropoff,accepting:!!row.accepting,visible:!!row.visible,submissionMode:row.submissionMode as Provider['submissionMode'],collector:{name:p?.name||'Collector',handle:p?.handle||''},rating:stats?.rating??null,reviewCount:stats?.reviewCount??0,completedReviewCount:stats?.completedReviewCount??0,categoryRatings:{quality:stats?.quality??null,communication:stats?.communication??null,timeliness:stats?.timeliness??null},rank:null,...(own?{shippingAddress,shippingNotes}:{})};
}
async function jobDto(db:Db,row:JobRow,me:P,known?:{providers:Map<string,ProviderRow>;people:Map<string,P>}):Promise<CareJob>{
 const provider=known?known.providers.get(row.providerId):(await db.select().from(careProviders).where(eq(careProviders.id,row.providerId)))[0];
 const people=known?[known.people.get(row.providerProfileId),known.people.get(row.requesterId)].filter((p):p is P=>!!p):await db.select().from(profiles).where(inArray(profiles.id,[row.providerProfileId,row.requesterId]));
 return {...row,...careIntakeForViewer(row,me.id),books:JSON.parse(row.books),services:JSON.parse(row.services),sendToCgc:!!row.sendToCgc,method:row.method as CareJob['method'],providerName:provider?.name||'Former provider',requesterName:people.find(p=>p.id===row.requesterId)?.name||'Collector',providerHandle:people.find(p=>p.id===row.providerProfileId)?.handle||'',isProvider:me.id===row.providerProfileId};
}
function eventStatement(db:Db,jobId:string,actorId:string,status:string,note:string,photos:string[]=[],stamp=now()){return db.insert(careEvents).values({id:crypto.randomUUID(),jobId,actorId,status,note,photos:JSON.stringify(photos),createdAt:stamp})}
async function commitCareEvent(db:Db,job:JobRow,actor:P,update:Partial<JobRow>,status:string,note:string,photos:string[]=[],validation:SQL=sql`true`){
 const checked=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM care_jobs current
  JOIN profiles requester ON requester.id = current.requester_id JOIN profiles provider ON provider.id = current.provider_profile_id
  WHERE current.id = ${job.id} AND current.status = ${job.status} AND current.quote_revision = ${job.quoteRevision}
   AND ${actor.id} IN (current.requester_id,current.provider_profile_id)
   AND EXISTS (SELECT 1 FROM profiles signed_in WHERE signed_in.id = ${actor.id} AND signed_in.user_id = ${actor.userId})
   AND ${validation})`);
 const stamp=now();
 try{await db.batch([checked.start,db.update(careJobs).set({...update,updatedAt:stamp}).where(eq(careJobs.id,job.id)),eventStatement(db,job.id,actor.id,status,note,photos,stamp),checked.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('This request or quote changed. Reload it before continuing.',409);throw error}
}
async function ownJob(db:Db,jobId:string,p:P){const [j]=await db.select().from(careJobs).where(eq(careJobs.id,jobId));return j&&[j.providerProfileId,j.requesterId].includes(p.id)?j:null}

export async function GET(req:Request){try{
 const u=await getChatGPTUser();if(!u)return json({error:'Sign in to open the Press Room.'},401);
 const db=getDb(),url=new URL(req.url);const [me]=await db.select().from(profiles).where(eq(profiles.userId,u.userId));
 if(url.searchParams.get('kind')==='job'){
  if(!me)return json({error:'Create your free collector profile first.'},403);
  const j=await ownJob(db,url.searchParams.get('id')||'',me);if(!j)return json({error:'Request not found.'},404);
  const rows=await db.select().from(careEvents).where(eq(careEvents.jobId,j.id)).orderBy(careEvents.createdAt);
  const actors=await carePeople(db,rows.map(e=>e.actorId));const events=[];for(const row of rows){const actor=actors.get(row.actorId);events.push({...row,photos:JSON.parse(row.photos),authorName:actor?.name||'Collector'})}
  return json({job:await jobDto(db,j,me),events});
 }
 const publicRows=await db.select().from(careProviders).where(eq(careProviders.visible,1)).orderBy(desc(careProviders.createdAt)).limit(200);
 const [people,stats,hidden]=await Promise.all([carePeople(db,publicRows.map(r=>r.profileId)),providerStats(db,publicRows.map(r=>r.id)),me?blockedPeerIds(db,me.id,publicRows.map(r=>r.profileId)):Promise.resolve(new Set<string>())]);
 const directory:Provider[]=[];for(const row of publicRows){const p=people.get(row.profileId);if(p?.visible&&!p.moderated&&!row.moderated&&!hidden.has(p.id))directory.push(await providerDto(db,row,false,{profile:p,stats:stats.get(row.id)}))}
 const ranked=rankProviders(directory);
 if(url.searchParams.get('kind')==='provider'){
  const providerId=url.searchParams.get('id')||'';let provider=ranked.find(p=>p.id===providerId);
  if(!provider&&me){const [own]=await db.select().from(careProviders).where(and(eq(careProviders.id,providerId),eq(careProviders.profileId,me.id)));if(own)provider=await providerDto(db,own,true)}
  if(!provider)return json({error:'Provider not found.'},404);
  const rows=await db.select().from(careReviews).where(eq(careReviews.providerId,provider.id)).orderBy(desc(careReviews.updatedAt)).limit(100);
  const authors=await carePeople(db,rows.map(r=>r.authorId)),hiddenAuthors=me?await blockedPeerIds(db,me.id,rows.map(r=>r.authorId)):new Set<string>();const reviews=[];for(const row of rows){const author=authors.get(row.authorId);const {jobId,authorId,...publicReview}=row;if(author&&!hiddenAuthors.has(author.id))reviews.push({...publicReview,author:{id:author.id,name:author.name,handle:author.handle},completedRequest:!!jobId,mine:authorId===me?.id})}
  return json({provider,reviews});
 }
 const [mine]=me?await db.select().from(careProviders).where(eq(careProviders.profileId,me.id)):[];
 const jobs=me?await db.select().from(careJobs).where(or(eq(careJobs.requesterId,me.id),eq(careJobs.providerProfileId,me.id))).orderBy(desc(careJobs.updatedAt)).limit(200):[];
 const jobProviders=new Map(publicRows.map(p=>[p.id,p]));if(mine)jobProviders.set(mine.id,mine);for(const batch of chunks([...new Set(jobs.map(j=>j.providerId))].filter(id=>!jobProviders.has(id)))){for(const row of await db.select().from(careProviders).where(inArray(careProviders.id,batch)))jobProviders.set(row.id,row)}
 const jobPeople=await carePeople(db,[...new Set(jobs.flatMap(j=>[j.providerProfileId,j.requesterId]))].filter(id=>!people.has(id)));for(const [id,p] of people)jobPeople.set(id,p);if(me)jobPeople.set(me.id,me);
 return json({providers:ranked,mine:mine?await providerDto(db,mine,true,stats.has(mine.id)?{profile:me,stats:stats.get(mine.id)}:undefined):null,jobs:await Promise.all(jobs.map(j=>jobDto(db,j,me!,{providers:jobProviders,people:jobPeople})))});
 }catch{return json({error:'Could not load pressing services. Please retry.'},500)}}

export async function POST(req:Request){try{
 const u=await getChatGPTUser();if(!u)return json({error:'Sign in to continue.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Request origin rejected.'},403);
 const a=await readObject(req,40000),db=getDb(),action=typeof a.action==='string'?a.action:'unknown';
 const budgets:Record<string,number>={provider:30,review:15,delete_review:15,request:10,quote:30,approve:30,stage:60};const limited=await enforceWriteLimits(db,u.userId,'care:'+(Object.hasOwn(budgets,action)?action:'unknown'),Object.hasOwn(budgets,action)?budgets[action]:5);if(limited)return limited;
 const [p]=await db.select().from(profiles).where(eq(profiles.userId,u.userId));if(!p)return json({error:'Create your free collector profile first.',code:'profile_required'},403);
 if(['provider','review','request'].includes(action)){if(p.moderated||await isRestricted(db,u.userId))return json({error:'Your account is restricted pending moderation review.'},403);if(p.rulesVersion!==previewRulesVersion||!p.rulesAcceptedAt)return json({error:'Open your collector profile and accept the current community rules before continuing.'},403)}
 if(a.action==='provider'){
  if(await isRestricted(db,u.userId,'provider'))return json({error:'Your provider profile is restricted pending moderation review.'},403);
  const v=z.object({name:short(80),bio:short(1200),location:short(100),services,prices:z.record(z.string(),cents.nullable()),specialties:z.string().max(300),experienceSince:z.number().int().min(1930).max(new Date().getFullYear()),turnaroundMin:z.number().int().min(1).max(365),turnaroundMax:z.number().int().min(1).max(365),mailIn:z.boolean(),dropoff:z.boolean(),accepting:z.boolean(),visible:z.boolean(),submissionMode:z.enum(['none','prepare_only','dealer']),dealerReference:web,website:web,logoId:id.nullable(),portfolio:z.array(z.object({before:id,after:id,caption:short(200)})).max(4),shippingAddress:z.string().trim().max(1000),shippingNotes:z.string().max(1500),terms:short(2000),attest:z.literal(true),dealerAttest:z.boolean()}).parse(a);
  if(!p.visible||!p.dmOpen)return json({error:'Enable your collector showcase and messages before listing a service.'},400);
  if(v.turnaroundMax<v.turnaroundMin||!v.mailIn&&!v.dropoff||v.mailIn&&!v.shippingAddress)return json({error:'Check your turnaround and intake details.'},400);
  if(v.services.includes('cgc')!== (v.submissionMode!=='none'))return json({error:'Select a CGC support type when offering that service.'},400);
  if(v.submissionMode==='dealer'&&(!v.dealerAttest||!v.dealerReference))return json({error:'Confirm current CGC dealer submission eligibility and provide your dealer reference.'},400);
  if(Object.keys(v.prices).some(k=>!v.services.includes(k as typeof v.services[number])))return json({error:'Prices must belong to your selected services.'},400);
  if(!await ownedPhotos(db,u.userId,[...(v.logoId?[v.logoId]:[]),...v.portfolio.flatMap(x=>[x.before,x.after])]))return json({error:'Use your own uploaded portfolio photos.'},403);
  const [existing]=await db.select().from(careProviders).where(eq(careProviders.profileId,p.id));if(existing?.moderated)return json({error:'Your provider profile is restricted pending moderation review.'},403);
  const {attest,dealerAttest,...fields}=v;const data={...fields,services:JSON.stringify(v.services),prices:JSON.stringify(v.prices),portfolio:JSON.stringify(v.portfolio),mailIn:Number(v.mailIn),dropoff:Number(v.dropoff),accepting:Number(v.accepting),visible:Number(v.visible),updatedAt:now()};
  if(existing)await db.update(careProviders).set(data).where(eq(careProviders.id,existing.id));else await db.insert(careProviders).values({...data,id:crypto.randomUUID(),profileId:p.id,createdAt:now()});
  return json({saved:true});
 }
 if(a.action==='review'){
  const score=z.number().int().min(1).max(5);const v=z.object({providerId:id,rating:score,quality:score,communication:score,timeliness:score,title:short(100),body:short(2000),attest:z.literal(true)}).parse(a);
  const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,v.providerId));if(!provider||!provider.visible||provider.moderated||await blocked(db,p.id,provider.profileId))return json({error:'Provider unavailable.'},404);
  if(provider.profileId===p.id)return json({error:'You cannot review your own service.'},403);
  const [job]=await db.select().from(careJobs).where(and(eq(careJobs.providerId,provider.id),eq(careJobs.requesterId,p.id),eq(careJobs.status,'completed'))).limit(1);
  const {attest,...fields}=v;await db.insert(careReviews).values({...fields,id:crypto.randomUUID(),authorId:p.id,jobId:job?.id||null,createdAt:now(),updatedAt:now()}).onConflictDoUpdate({target:[careReviews.providerId,careReviews.authorId],set:{...fields,jobId:job?.id||null,updatedAt:now()}});
  return json({saved:true});
 }
 if(a.action==='delete_review'){const v=z.object({reviewId:id}).parse(a);const rows=await db.delete(careReviews).where(and(eq(careReviews.id,v.reviewId),eq(careReviews.authorId,p.id))).returning({id:careReviews.id});return rows.length?json({saved:true}):json({error:'Review not found.'},404)}
 if(a.action==='request'){
  const v=z.object({providerId:id,bookIds:z.array(z.string().min(1).max(80)).min(1).max(20).refine(b=>new Set(b).size===b.length),declaredValues:z.record(z.string(),cents),services,notes:z.string().max(2000),sendToCgc:z.boolean(),method:z.enum(['mail','dropoff']),scopeConsent:z.literal(true)}).parse(a);
  const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,v.providerId));
  const [owner]=provider?await db.select().from(profiles).where(eq(profiles.id,provider.profileId)):[];
  if(!provider?.visible||provider.moderated||!provider.accepting||!owner?.visible||owner.moderated||!owner.dmOpen||provider.profileId===p.id||await blocked(db,p.id,provider.profileId))return json({error:'This provider cannot receive your request.'},400);
  const offered=JSON.parse(provider.services) as string[];if(v.services.some(s=>!offered.includes(s))||v.sendToCgc&&(!v.services.includes('cgc')||provider.submissionMode!=='dealer'))return json({error:'The selected CGC or care service is unavailable.'},400);
  if(v.method==='mail'&&!provider.mailIn||v.method==='dropoff'&&!provider.dropoff)return json({error:'Choose an available intake method.'},400);
  const [row]=await db.select().from(collections).where(eq(collections.userId,u.userId));const vault=row?vaultSchema.parse(JSON.parse(row.data)):emptyVault(p.name);
  const books=v.bookIds.map(id=>vault.books.find(b=>b.id===id));if(books.some(b=>!b))return json({error:'Only request service for comics in your own collection.'},400);
  const [left,right]=[p.id,provider.profileId].sort(),pair=left+':'+right,jobId=crypto.randomUUID();
  const stamp=now(),selected=JSON.stringify(v.bookIds);
  const checked=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM care_providers studio
   JOIN profiles owner ON owner.id = studio.profile_id JOIN profiles collector ON collector.id = ${p.id}
   JOIN collections inventory ON inventory.user_id = collector.user_id
   WHERE studio.id = ${provider.id} AND studio.profile_id = ${provider.profileId}
    AND studio.visible = 1 AND studio.moderated = 0 AND studio.accepting = 1
    AND studio.updated_at = ${provider.updatedAt} AND studio.services = ${provider.services}
    AND studio.submission_mode = ${provider.submissionMode}
    AND (${v.method} != 'mail' OR studio.mail_in = 1) AND (${v.method} != 'dropoff' OR studio.dropoff = 1)
    AND owner.visible = 1 AND owner.dm_open = 1 AND owner.moderated = 0
    AND collector.user_id = ${u.userId} AND collector.moderated = 0
    AND collector.rules_version = ${previewRulesVersion} AND collector.rules_accepted_at != ''
    AND inventory.revision = ${row?.revision||''}
    AND NOT EXISTS (SELECT 1 FROM json_each(${selected}) selected_copy WHERE selected_copy.value NOT IN
     (SELECT json_extract(copy.value, '$.id') FROM json_each(inventory.data, '$.books') copy))
    AND NOT EXISTS (SELECT 1 FROM account_restrictions restriction WHERE
     (restriction.user_id = owner.user_id AND restriction.scope IN ('account','provider'))
     OR (restriction.user_id = collector.user_id AND restriction.scope = 'account'))
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = owner.id AND b.to_id = collector.id) OR (b.from_id = collector.id AND b.to_id = owner.id)))`);
  try{const saved=await db.batch([checked.start,db.insert(threads).values({id:crypto.randomUUID(),pair,a:left,b:right,context:'Press Room · '+provider.name,createdAt:stamp}).onConflictDoNothing(),db.insert(careJobs).values({id:jobId,providerId:provider.id,providerProfileId:provider.profileId,requesterId:p.id,threadId:sql`(SELECT id FROM threads WHERE pair = ${pair})`,books:JSON.stringify(books.map(b=>{const {price,...copy}=b!;return {...copy,declaredValue:v.declaredValues[b!.id]??Math.round(price*100)}})),services:JSON.stringify(v.services),notes:v.notes,sendToCgc:Number(v.sendToCgc),status:'requested',method:v.method,fee:null,returnShipping:null,cgcEstimate:null,quoteNotes:'',quoteDays:null,quoteRevision:0,termsSnapshot:'',shippingAddress:'',shippingNotes:'',returnAddress:'',incomingCarrier:'',incomingTracking:'',outgoingCarrier:'',outgoingTracking:'',submissionRef:'',createdAt:stamp,updatedAt:stamp}).returning({threadId:careJobs.threadId}),eventStatement(db,jobId,p.id,'requested','Quote requested. Pressing / dry cleaning only; any restoration requires a separate agreement.',[],stamp),checked.finish]);if(!Array.isArray(saved[2])||!saved[2][0])throw Error('Care request was not saved.');return json({saved:true,jobId,threadId:saved[2][0].threadId})}
  catch(error){if(operationGuardFailed(error))throw new ApiRequestError('The provider or your collection changed. Reload before requesting care.',409);throw error}
 }
 const v=z.object({jobId:id}).parse(a),j=await ownJob(db,v.jobId,p);if(!j)return json({error:'Request not found.'},404);
 const isProvider=j.providerProfileId===p.id;
 if(a.action==='quote'){
  if(!isProvider||!['requested','quoted'].includes(j.status))return json({error:'This request cannot be quoted.'},403);
  const q=z.object({fee:cents,returnShipping:cents,cgcEstimate:cents,quoteDays:z.number().int().min(1).max(365),quoteNotes:short(2000),revision:z.number().int().min(0)}).parse(a);
  if(q.revision!==j.quoteRevision)return json({error:'The quote changed. Reload the request.'},409);
  const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,j.providerId));if(!provider||provider.moderated||p.moderated||await isRestricted(db,u.userId)||await isRestricted(db,u.userId,'provider')||j.sendToCgc&&provider.submissionMode!=='dealer')return json({error:'Confirm current dealer eligibility before quoting a CGC submission.'},400);
  const eligibility=sql`EXISTS (SELECT 1 FROM care_providers studio JOIN profiles owner ON owner.id = studio.profile_id
   WHERE studio.id = ${provider.id} AND owner.id = ${p.id} AND owner.moderated = 0 AND studio.moderated = 0
    AND studio.updated_at = ${provider.updatedAt} AND (${j.sendToCgc} = 0 OR studio.submission_mode = 'dealer')
    AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.user_id = owner.user_id AND r.scope IN ('account','provider')))`;
  await commitCareEvent(db,j,p,{fee:q.fee,returnShipping:j.method==='mail'?q.returnShipping:0,cgcEstimate:j.sendToCgc?q.cgcEstimate:0,quoteDays:q.quoteDays,quoteNotes:q.quoteNotes,termsSnapshot:provider.terms,shippingAddress:provider.shippingAddress,shippingNotes:provider.shippingNotes,status:'quoted',quoteRevision:j.quoteRevision+1},'quoted','Quote revision '+(j.quoteRevision+1)+' is ready for review. No payment was processed.',[],eligibility);return json({saved:true});
 }
 if(a.action==='approve'){
  if(isProvider||j.status!=='quoted')return json({error:'Only the collector can accept this quote.'},403);
  const q=z.object({revision:z.number().int(),returnAddress:z.string().trim().max(1000),riskConsent:z.literal(true),termsConsent:z.literal(true),cgcConsent:z.boolean()}).parse(a);
  if(q.revision!==j.quoteRevision)return json({error:'The quote changed. Review the latest revision.'},409);
  if(j.method==='mail'&&!q.returnAddress)return json({error:'Enter a private return shipping address.'},400);
  const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,j.providerId));if(j.sendToCgc&&(!q.cgcConsent||provider?.submissionMode!=='dealer'))return json({error:'Verify dealer eligibility and authorize the CGC submission.'},400);
  const eligibility=j.sendToCgc?sql`EXISTS (SELECT 1 FROM care_providers studio WHERE studio.id = ${j.providerId} AND studio.submission_mode = 'dealer')`:sql`true`;
  await commitCareEvent(db,j,p,{status:'approved',returnAddress:q.returnAddress},'approved','Collector accepted quote revision '+q.revision+' and the stated scope, risks and provider terms.'+(j.sendToCgc?' Third-party CGC submission authorized.':''),[],eligibility);return json({saved:true});
 }
 if(a.action==='stage'){
  const q=z.object({status:z.enum(['in_transit','received','pressing','at_grading','returning','completed','cancelled','declined']),note:z.string().max(2000),photos:z.array(id).max(6),carrier:z.string().trim().max(80),tracking:z.string().trim().max(100),submissionRef:z.string().trim().max(100)}).parse(a);
  if(!canCareTransition(j.status,q.status,isProvider,!!j.sendToCgc))return json({error:'This stage is unavailable for your role or the current request.'},403);
  if(j.method==='dropoff'&&q.status==='in_transit')return json({error:'The provider confirms receipt for drop-off requests.'},400);
  if(j.method==='mail'&&['in_transit','returning'].includes(q.status)&&(!q.carrier||!q.tracking))return json({error:'Add the carrier and tracking number before confirming shipment.'},400);
  if(q.status==='returning'&&(j.status==='received'||j.status==='pressing'&&j.sendToCgc)&&q.note.trim().length<20)return json({error:'Explain why care or the requested grading submission was skipped before returning the books.'},400);
  if(!await ownedPhotos(db,u.userId,q.photos))return json({error:'Use your own uploaded condition photos.'},403);
  if(q.status==='at_grading'){const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,j.providerId));if(provider?.submissionMode!=='dealer'||!q.submissionRef)return json({error:'Dealer eligibility and a CGC submission reference are required.'},400)}
  const update:Partial<JobRow>={status:q.status,updatedAt:now()};if(q.status==='in_transit'){update.incomingCarrier=q.carrier;update.incomingTracking=q.tracking}if(q.status==='returning'){update.outgoingCarrier=q.carrier;update.outgoingTracking=q.tracking}if(q.status==='at_grading')update.submissionRef=q.submissionRef;
  const eligibility=q.status==='at_grading'?sql`EXISTS (SELECT 1 FROM care_providers studio WHERE studio.id = ${j.providerId} AND studio.submission_mode = 'dealer')`:sql`true`;
  await commitCareEvent(db,j,p,update,q.status,q.note||'Stage updated by '+(isProvider?'provider':'collector')+'.',q.photos,eligibility);return json({saved:true});
 }
 return json({error:'Unknown action.'},400);
 }catch(e){if(e instanceof ApiRequestError)return json({error:e.message},e.status);if(e instanceof z.ZodError)return json({error:'Please check the required fields and consent boxes.'},400);if(e instanceof Error&&['You cannot message yourself.','This collector is not accepting messages.'].includes(e.message))return json({error:e.message},403);return json({error:'Could not save this service request. Please retry.'},500)}}
