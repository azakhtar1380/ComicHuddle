import {ensureSellerPhotos} from './seller-photos';
import type {CombinedEstimate} from './estimated-fmv-types';
import {catalogIssuesById} from './catalog-store';
import {resolveLocation} from './location-search';
import {and,asc,desc,eq,gt,gte,inArray,lt,lte,or,sql,type SQL} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '../db';
import {auctionBids,collections,listingInventory,listings,marketValues,media,offers,profiles,commerceOrders,threads,messages,directoryIssues,tradeProposals,accountRestrictions} from '../db/schema';
import {catalog,grades,normalize} from './catalog';
import {type Listing,type ListingAuction,type ListingCondition,type ListingItem,type ListingValuation,type TradeProposal,type TradeTermsData,previewRulesVersion,listingStateCodes} from './community';
import {vaultSchema,type Vault} from './vault';
import {freshValue,marketKey} from './market-data';
import {ApiRequestError,chunks,isRestricted,readBytes} from './api-security';
import {blocked} from './conversations';
import {listingDirectoryId} from './shared-catalog';
import {linkedCatalogIssue} from './catalog-search';
import {conditionalGuard as guard,operationGuardFailed as marketplaceGuardFailed} from './operation-guard';
export {marketplaceGuardFailed};

type Db=ReturnType<typeof getDb>;
type ListingRow=typeof listings.$inferSelect;
type Profile=typeof profiles.$inferSelect;
type Bid=typeof auctionBids.$inferSelect;
type MarketRow=typeof marketValues.$inferSelect;
export const marketplaceMaxCents=100000000;
const cents=z.number().int().min(100).max(marketplaceMaxCents);
const bookId=z.string().trim().min(1).max(80);
const externalCatalogSchema=z.object({provider:z.enum(['Metron','GCD']),id:z.number().int().min(1).max(2147483647),sourceUrl:z.string().max(120),license:z.literal('CC BY-SA 4.0')}).strict().refine(v=>v.sourceUrl===(v.provider==='Metron'?'https://metron.cloud/issue/'+v.id+'/':'https://www.comics.org/issue/'+v.id+'/'));
const fulfillmentSchema=z.enum(['shipping','pickup','both']);
const citySchema=z.string().trim().max(80).refine(v=>!v||/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(v),'Use a city name only, without a street address or ZIP code.');
const conditionSchema=z.object({mode:z.enum(['Raw','CGC']),grade:z.string().refine(s=>grades.includes(s)),label:z.enum(['Raw','Universal','Signature Series','Qualified','Restored','Conserved']),printing:z.enum(['First printing','Second printing','Third printing','Later printing','Facsimile','Reprint']),language:z.string().max(40).optional(),signatureStatus:z.string().max(50).optional(),restorationStatus:z.string().max(50).optional(),certificationNumber:z.string().max(40).optional()}).strict().refine(v=>(v.mode==='Raw')===(v.label==='Raw'),'Raw condition must use the Raw label.');
const creationSchema=z.object({
 action:z.literal('listing'),safePurchaseOptIn:z.boolean().default(false),locationZip:z.string().regex(/^\d{5}$/).optional(),kind:z.enum(['single','collection']).default('single'),saleType:z.enum(['fixed','auction']).default('fixed'),
 bookId:bookId.optional(),bookIds:z.array(bookId).min(1).max(1000).refine(ids=>new Set(ids).size===ids.length).optional(),
 conditions:z.record(bookId,conditionSchema).refine(v=>Object.keys(v).length<=1000).default({}),title:z.string().trim().min(1).max(200).optional(),
 description:z.string().trim().min(1).max(2000),price:cents,shipping:z.number().int().min(0).max(100000),
 photos:z.array(z.string().uuid()).min(1).max(6).refine(ids=>new Set(ids).size===ids.length),cert:z.string().max(40).default(''),attest:z.literal(true),usaAttest:z.boolean().optional(),
 durationHours:z.number().int().min(1).max(168).default(72),bidIncrement:z.number().int().min(100).max(1000000).default(500),
 fulfillment:fulfillmentSchema.default('shipping'),pickupCity:citySchema.default(''),pickupState:z.union([z.enum(listingStateCodes),z.literal('')]).default('')
}).strict().superRefine((v,ctx)=>{
 if(v.fulfillment!=='shipping'&&(v.pickupCity.length<2||!v.pickupState))ctx.addIssue({code:z.ZodIssueCode.custom,path:['pickupCity'],message:'Choose a public pickup city and state.'});
 if(v.fulfillment==='shipping'&&(v.pickupCity||v.pickupState))ctx.addIssue({code:z.ZodIssueCode.custom,path:['pickupCity'],message:'Pickup location applies only to pickup listings.'});
 if(v.fulfillment==='pickup'&&v.shipping!==0)ctx.addIssue({code:z.ZodIssueCode.custom,path:['shipping'],message:'Pickup-only listings cannot charge shipping.'});
});

// Collection listings need a larger bounded payload; other actions retain their
// original 25 KB limit even when oversized padding would otherwise be stripped.
export async function readSocialObject(req:Request){
 const bytes=await readBytes(req,1000000);let value:unknown;
 try{value=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new ApiRequestError('Invalid request.',400)}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiRequestError('Request must be a JSON object.',400);
 const object=value as Record<string,unknown>,limit=object.action==='listing'?1000000:25000;
 if(bytes.byteLength>limit||Number(req.headers.get('content-length'))>limit)throw new ApiRequestError('Request too large.',413);
 return object;
}

function snapshot(copy:Vault['books'][number],condition?:ListingCondition):ListingItem{
 return {id:copy.id,bookId:copy.id,title:copy.title,issue:copy.issue,grade:copy.grade,...(copy.catalogId===undefined?{}:{catalogId:copy.catalogId}),...(copy.externalCatalog?{externalCatalog:copy.externalCatalog}:{}),...(copy.photoId?{photoId:copy.photoId}:{}),...(condition?{condition}:{})};
}
export function listingItems(row:ListingRow):ListingItem[]{
 const stored=JSON.parse(row.items) as unknown;
 if(!Array.isArray(stored))throw new ApiRequestError('The listing record is unavailable.',500);
 if(!stored.length){if(row.bookId==='deleted')return [];return [{id:row.bookId,bookId:row.bookId,title:row.title,issue:'',grade:row.grade,...(row.issueId===null?{}:{catalogId:row.issueId})}]}
 return stored.map(raw=>{
  if(!raw||typeof raw!=='object')throw new ApiRequestError('The listing record is unavailable.',500);
  const item=raw as Record<string,unknown>,id=typeof item.bookId==='string'?item.bookId:typeof item.id==='string'?item.id:'';
  if(!id||typeof item.title!=='string'||typeof item.issue!=='string'||typeof item.grade!=='string')throw new ApiRequestError('The listing record is unavailable.',500);
  const condition=conditionSchema.safeParse(item.condition),externalCatalog=externalCatalogSchema.safeParse(item.externalCatalog);
  return {id,bookId:id,title:item.title,issue:item.issue,grade:item.grade,...(externalCatalog.success?{externalCatalog:externalCatalog.data}:{}),...(!externalCatalog.success&&typeof item.catalogId==='number'&&Number.isInteger(item.catalogId)&&catalog.some(c=>c.id===item.catalogId)?{catalogId:item.catalogId}:{}),...(typeof item.photoId==='string'&&z.string().uuid().safeParse(item.photoId).success?{photoId:item.photoId}:{}),...(condition.success?{condition:condition.data}:{})};
 });
}
export function listingValuation(items:ListingItem[],values:Map<string,MarketRow|null>,stamp=Date.now()):ListingValuation{
 let knownTotal=0,pricedCount=0,asOf:string|null=null;const sources=new Set<string>();
 for(const item of items){
  const directoryId=listingDirectoryId(item);if(directoryId===null||!item.condition||(!item.externalCatalog&&!linkedCatalogIssue(item)))continue;
  const row=values.get(marketKey({issueId:directoryId,...item.condition}));
  if(!row||!row.licenseReference||!Number.isFinite(Date.parse(row.rightsExpiresAt))||Date.parse(row.rightsExpiresAt)<=stamp||!freshValue(row.updatedAt)||!Number.isFinite(row.fmv)||row.fmv<=0)continue;
  const amount=Math.round(row.fmv*100);if(!Number.isSafeInteger(amount)||amount<=0)continue;
  knownTotal+=amount;pricedCount++;sources.add(row.sourceName);if(!asOf||row.updatedAt<asOf)asOf=row.updatedAt;
 }
 const complete=items.length>0&&pricedCount===items.length;
 return {total:complete?knownTotal:null,knownTotal:pricedCount?knownTotal:null,pricedCount,totalCount:items.length,status:complete?'complete':pricedCount?'partial':'unavailable',asOf,sourceNames:[...sources].sort()};
}
export function auctionView(row:ListingRow,viewerId?:string,ownBid?:Bid,stamp=Date.now()):ListingAuction|null{
 if(row.saleType!=='auction')return null;
 const ended=row.status!=='active'||!Number.isFinite(Date.parse(row.endAt))||Date.parse(row.endAt)<=stamp;
 const next=row.currentBid===null?row.price:row.currentBid+row.bidIncrement;
 const leading=!!viewerId&&row.leaderId===viewerId&&row.leadingBidId!==null&&row.status!=='cancelled'&&row.status!=='withdrawn';
 return {endAt:row.endAt,bidIncrement:row.bidIncrement,currentBid:row.currentBid,minNextBid:ended||next>marketplaceMaxCents?null:next,bidCount:row.bidCount,ended,leading,yourBid:ownBid?.amount??null,yourBidId:ownBid?.id??null,yourBidStatus:ownBid?(row.leadingBidId===ownBid.id&&leading?'leading':'outbid'):null,nonbinding:true};
}
export type ListingContext={aiEstimates?:Map<string,CombinedEstimate>;values:Map<string,MarketRow|null>;ownBids:Map<string,Bid>;stamp:number};
export async function listingContext(db:Db,rows:ListingRow[],viewerId?:string):Promise<ListingContext>{
 const stamp=Date.now(),values=new Map<string,MarketRow|null>(),ownBids=new Map<string,Bid>();
 if(viewerId){for(const batch of chunks(rows.filter(row=>row.saleType==='auction').map(row=>row.id))){
  const own=await db.select().from(auctionBids).where(inArray(auctionBids.id,db.select({id:sql<string>`(SELECT own.id FROM auction_bids own WHERE own.listing_id = ${sql.raw('listings.id')} AND own.bidder_id = ${viewerId} AND own.status IN ('leading','outbid') ORDER BY own.sequence DESC LIMIT 1)`}).from(listings).where(inArray(listings.id,batch))));
  for(const bid of own)ownBids.set(bid.listingId,bid);
 }}
 return {values,ownBids,stamp};
}
export function listingDto(row:ListingRow,seller:Pick<Profile,'id'|'name'|'handle'|'createdAt'>|undefined,viewerId:string|undefined,context:ListingContext):Listing{
 const items=listingItems(row),auction=auctionView(row,viewerId,context.ownBids.get(row.id),context.stamp),fulfillment=fulfillmentSchema.parse(row.fulfillment);
 // Select every public field explicitly; ledger identities, vault revision,
 // internal CAS versions and private inventory prices never leave this DTO.
 return {id:row.id,sellerId:row.sellerId,bookId:row.bookId,issueId:row.issueId,title:row.title,grade:row.grade,description:row.description,price:row.price,shipping:row.shipping,photos:JSON.parse(row.photos),cert:row.cert,status:row.status==='active'&&auction?.ended?'ended':row.status,createdAt:row.createdAt,safePurchaseOptIn:!!row.safePurchaseOptIn,safePurchaseVerifiedAt:row.safePurchaseVerifiedAt,locationCity:row.locationCity,locationState:row.locationState,seller:{id:seller?.id||'',name:seller?.name||'Former collector',handle:seller?.handle||'',...(seller?.createdAt?{createdAt:seller.createdAt}:{})},fulfillment,pickupCity:fulfillment==='shipping'?'':row.pickupCity,pickupState:fulfillment==='shipping'?'':row.pickupState,kind:row.kind==='collection'?'collection':'single',saleType:row.saleType==='auction'?'auction':'fixed',items,itemCount:items.length,auction};
}

function databaseMessage(error:unknown){let current=error;const parts:string[]=[];for(let i=0;i<5&&current&&typeof current==='object';i++){const e=current as {message?:unknown;cause?:unknown};if(typeof e.message==='string')parts.push(e.message);current=e.cause}return parts.join(' ')}
// The predicate must use immutable listing identifiers (id or sellerId), so it
// still selects the same records after changing their status inside the batch.
export function closeListingStatements(db:Db,where:SQL,status:'withdrawn'|'cancelled'|SQL){
 const ids=db.select({id:listings.id}).from(listings).where(where);
 return [
  db.update(listings).set({status}).where(where),
  db.delete(listingInventory).where(and(inArray(listingInventory.listingId,ids),sql`NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = ${sql.raw('listing_inventory.listing_id')} AND o.status NOT IN ('cancelled','checkout_expired'))`)),
  db.update(auctionBids).set({status:'cancelled'}).where(and(inArray(auctionBids.listingId,ids),inArray(auctionBids.status,['leading','outbid']))),
  db.update(offers).set({status:'closed'}).where(and(inArray(offers.listingId,ids),eq(offers.status,'pending'))),
  db.update(tradeProposals).set({status:'cancelled',version:sql`${tradeProposals.version} + 1`,updatedAt:new Date().toISOString(),decidedAt:new Date().toISOString(),decidedBy:null}).where(and(inArray(tradeProposals.listingId,ids),eq(tradeProposals.status,'pending')))
 ] as const;
}
export async function withdrawListing(db:Db,me:Profile,listingId:string){
 const checked=guard(db,sql`EXISTS (SELECT 1 FROM listings l WHERE l.id = ${listingId} AND l.seller_id = ${me.id} AND (l.sale_type != 'auction' OR l.bid_count = 0)) AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = ${listingId} AND o.status NOT IN ('cancelled','refunded','checkout_expired'))`);
 try{await db.batch([checked.start,...closeListingStatements(db,eq(listings.id,listingId),'withdrawn'),checked.finish])}
 catch(error){if(marketplaceGuardFailed(error))throw new ApiRequestError('A listing with an open sandbox order or accepted auction proposal history cannot be withdrawn. Contact maliktecks@gmail.com for support.',409);throw error}
}
async function ownPhotos(db:Db,userId:string,ids:string[]){for(const batch of chunks([...new Set(ids)])){const rows=await db.select().from(media).where(inArray(media.id,batch));if(rows.length!==batch.length||rows.some(row=>row.userId!==userId))throw new ApiRequestError('Use only your own uploaded photos.',403)}}
export async function initializeSellerListings(db:Db,me:Profile){
 // Migrations change schema only. Existing previews are initialized lazily,
 // at most 25 of this authenticated seller's active single-copy rows per call.
 const pending=await db.select({id:listings.id}).from(listings).where(and(eq(listings.sellerId,me.id),eq(listings.status,'active'),eq(listings.items,'[]'),eq(listings.saleType,'fixed'),eq(listings.kind,'single'))).orderBy(asc(listings.createdAt),asc(listings.id)).limit(25);
 if(!pending.length)return;
 const ids=pending.map(row=>row.id),ownedRows=and(eq(listings.sellerId,me.id),inArray(listings.id,ids));
 const safeSnapshot=sql`COALESCE(
  (SELECT jsonb_build_array(jsonb_build_object('id', ${sql.raw('listings.book_id')}, 'bookId', ${sql.raw('listings.book_id')},
    'title', copy.value::jsonb->>'title', 'issue', copy.value::jsonb->>'issue',
    'grade', copy.value::jsonb->>'grade', 'catalogId', copy.value::jsonb->'catalogId',
    'photoId', copy.value::jsonb->>'photoId', 'externalCatalog', copy.value::jsonb->'externalCatalog'))::text
   FROM collections c, json_each(c.data, '$.books') copy
   WHERE c.user_id = ${me.userId} AND json_extract(copy.value, '$.id') = ${sql.raw('listings.book_id')} LIMIT 1),
  jsonb_build_array(jsonb_build_object('id', ${sql.raw('listings.book_id')}, 'bookId', ${sql.raw('listings.book_id')},
    'title', ${sql.raw('listings.title')}, 'issue', '', 'grade', ${sql.raw('listings.grade')}, 'catalogId', ${sql.raw('listings.issue_id')}))::text)`;
 await db.batch([
  db.update(listings).set({items:safeSnapshot,itemCount:1}).where(and(ownedRows,eq(listings.status,'active'),eq(listings.items,'[]'),eq(listings.saleType,'fixed'),eq(listings.kind,'single'))),
  db.insert(listingInventory).select(db.select({sellerId:listings.sellerId,bookId:listings.bookId,listingId:listings.id}).from(listings).where(and(ownedRows,eq(listings.status,'active'))).orderBy(asc(listings.createdAt),asc(listings.id))).onConflictDoNothing(),
  db.update(listings).set({status:'withdrawn'}).where(and(ownedRows,eq(listings.status,'active'),sql`NOT EXISTS (SELECT 1 FROM listing_inventory reserved WHERE reserved.listing_id = ${sql.raw('listings.id')})`)),
  db.update(offers).set({status:'closed'}).where(and(eq(offers.status,'pending'),inArray(offers.listingId,db.select({id:listings.id}).from(listings).where(and(ownedRows,eq(listings.status,'withdrawn')))))),
  db.delete(listingInventory).where(inArray(listingInventory.listingId,db.select({id:listings.id}).from(listings).where(and(ownedRows,eq(listings.status,'withdrawn')))))
 ]);
}
export async function createListing(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=creationSchema.parse(raw),selected=value.bookIds||(value.bookId?[value.bookId]:[]);
 await ensureSellerPhotos(me.userId,value.photos);
 if(!selected.length||value.kind==='single'&&selected.length!==1)throw new ApiRequestError('Choose one owned copy for a single listing, or up to 1,000 copies for a collection.',400);
 if(value.bookIds&&value.bookId&&value.bookId!==selected[0])throw new ApiRequestError('Check the selected copies before publishing.',400);
 const modern=['kind','saleType','bookIds','conditions','title','durationHours','bidIncrement','usaAttest','fulfillment','pickupCity','pickupState'].some(key=>Object.hasOwn(raw,key));
 if(modern&&value.usaAttest!==true)throw new ApiRequestError('Confirm USA-only eligibility and shipping before publishing.',400);
 if(!me.visible)throw new ApiRequestError('Enable your collector showcase before publishing a listing.',400);
 await initializeSellerListings(db,me);
 const [source]=await db.select().from(collections).where(eq(collections.userId,me.userId));
 if(!source)throw new ApiRequestError('Add your owned comics to your collection first.',400);
 const vault=vaultSchema.parse(JSON.parse(source.data)),owned=new Map(vault.books.map(copy=>[copy.id,copy]));
 if(selected.some(id=>!owned.has(id)))throw new ApiRequestError('Only copies in your own current collection may be listed.',400);
 if(Object.keys(value.conditions).some(id=>!selected.includes(id)))throw new ApiRequestError('Set conditions only for the selected copies.',400);
 const copies=selected.map(id=>owned.get(id)!),items=copies.map(copy=>snapshot(copy,value.conditions[copy.id]));
 const externalIds=[...new Set(copies.flatMap(copy=>{const id=copy.externalCatalog?listingDirectoryId(copy):null;return id===null?[]:[id]}))],externalRows=new Map<number,{id:number;metronId:number|null;gcdId:number|null;title:string;number:string}>();
 for(const batch of chunks(externalIds)){const rows=await catalogIssuesById(db,batch);for(const row of rows)externalRows.set(row.id,{id:row.id,metronId:row.metronId??null,gcdId:row.gcdId??null,title:row.title,number:row.number})}
 const legacyAliases=new Map<number,string>();for(const batch of chunks(externalIds)){const aliases=await db.execute(sql`SELECT id,title FROM ch_web.catalog_issues WHERE id IN (${sql.join(batch.map(id=>sql`${id}`),sql`, `)})`);for(const alias of aliases.rows)legacyAliases.set(Number(alias.id),String(alias.title))}
 const numberKey=(value:string)=>value.trim().replace(/^#\s*/,'').replace(/\s/g,'').toLowerCase();
 for(const copy of copies){if(!copy.externalCatalog)continue;const directoryId=listingDirectoryId(copy),record=directoryId===null?undefined:externalRows.get(directoryId),providerMatches=record&&(copy.externalCatalog.provider==='Metron'?record.metronId===copy.externalCatalog.id&&record.gcdId===null:record.gcdId===copy.externalCatalog.id&&record.metronId===null);if(!record||!providerMatches||(normalize(record.title)!==normalize(copy.title)&&normalize(legacyAliases.get(directoryId!)||'')!==normalize(copy.title))||numberKey(record.number)!==numberKey(copy.issue))throw new ApiRequestError('Correct the linked directory edition for each selected comic, or save it as an unlinked personal record before listing.',400)}
 const identityChecks=[...externalRows.values()].map(record=>sql`EXISTS(SELECT 1 FROM gcd.comichuddle_directory canonical WHERE canonical.id=${record.id} AND ${record.gcdId!==null?sql`canonical.gcd_id=${record.gcdId}`:sql`canonical.metron_id=${record.metronId}`} AND canonical.metron_id IS NOT DISTINCT FROM ${record.metronId}::bigint AND canonical.gcd_id IS NOT DISTINCT FROM ${record.gcdId}::bigint AND canonical.title=${record.title} AND canonical.number=${record.number})`);
 const identitiesCurrent=identityChecks.length?sql.join(identityChecks,sql` AND `):sql`true`;
 if(copies.some(copy=>copy.catalogId!==undefined&&!linkedCatalogIssue(copy)))throw new ApiRequestError('Correct the directory issue for each selected comic before publishing, or unlink it as a personal record.',400);
 await ownPhotos(db,me.userId,[...value.photos,...items.flatMap(item=>item.photoId?[item.photoId]:[])]);
 const stamp=new Date().toISOString(),selectedJSON=JSON.stringify(selected);
 const checked=guard(db,sql`EXISTS (SELECT 1 FROM profiles p JOIN collections c ON c.user_id = p.user_id
  WHERE p.id = ${me.id} AND p.user_id = ${me.userId} AND p.visible = 1 AND p.moderated = 0 AND p.deletion_started_at IS NULL
   AND c.revision = ${source.revision} AND NOT EXISTS
    (SELECT 1 FROM account_restrictions r WHERE r.user_id = p.user_id AND r.scope = 'account'))
  AND (${identitiesCurrent})
  AND json_array_length(${selectedJSON}) BETWEEN 1 AND 1000
  AND (${value.kind} != 'single' OR json_array_length(${selectedJSON}) = 1)
  AND (SELECT count(DISTINCT item.value) FROM json_each(${selectedJSON}) item) = ${selected.length}
  AND NOT EXISTS (SELECT 1 FROM json_each(${selectedJSON}) item WHERE item.type != 'text' OR length(trim(item.value)) = 0
   OR item.value NOT IN (SELECT json_extract(copy.value, '$.id') FROM collections c, json_each(c.data, '$.books') copy WHERE c.user_id = ${me.userId}))
  AND NOT EXISTS (SELECT 1 FROM listings legacy WHERE legacy.seller_id = ${me.id} AND legacy.status = 'active'
   AND legacy.items = '[]' AND NOT (legacy.sale_type = 'auction' AND legacy.end_at <= ${stamp})
   AND legacy.book_id IN (SELECT item.value FROM json_each(${selectedJSON}) item))
  AND NOT EXISTS (SELECT 1 FROM listing_inventory reserved JOIN listings occupied ON occupied.id = reserved.listing_id
   WHERE reserved.seller_id = ${me.id} AND (occupied.status = 'active' OR EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = occupied.id AND o.status NOT IN ('cancelled','refunded','checkout_expired')))
    AND NOT (occupied.sale_type = 'auction' AND occupied.end_at <= ${stamp})
    AND reserved.book_id IN (SELECT item.value FROM json_each(${selectedJSON}) item))`);
 const location=value.locationZip?await resolveLocation(db,value.locationZip):null;
 const listingId=crypto.randomUUID(),first=copies[0];
 try{
  await db.batch([
   checked.start,
   // Expiry creates no order and releases this seller's preview copies in the
   // same transaction, before a new listing attempts to reserve them again.
   db.update(listings).set({status:'ended'}).where(and(eq(listings.sellerId,me.id),eq(listings.saleType,'auction'),eq(listings.status,'active'),lte(listings.endAt,stamp))),
   db.delete(listingInventory).where(and(eq(listingInventory.sellerId,me.id),inArray(listingInventory.listingId,db.select({id:listings.id}).from(listings).where(and(eq(listings.sellerId,me.id),eq(listings.saleType,'auction'),eq(listings.status,'ended'),lte(listings.endAt,stamp)))))),
   db.insert(listings).values({id:listingId,sellerId:me.id,bookId:first.id,issueId:value.kind==='single'?first.externalCatalog?listingDirectoryId(first):linkedCatalogIssue(first)?.id??null:null,title:value.title||(value.kind==='single'?first.title+' '+first.issue:vault.profile+"'s "+items.length+'-comic collection'),grade:value.kind==='single'?first.grade:'Mixed conditions · see each copy',description:value.description,price:value.price,shipping:value.shipping,photos:JSON.stringify(value.photos),cert:value.cert,status:'active',createdAt:stamp,safePurchaseOptIn:value.safePurchaseOptIn?1:0,...(location?{locationZip:location.zip,locationCity:location.city,locationState:location.state,latitude:location.latitude,longitude:location.longitude}:{}),kind:value.kind,saleType:value.saleType,items:JSON.stringify(items),itemCount:items.length,endAt:value.saleType==='auction'?new Date(Date.parse(stamp)+value.durationHours*3600000).toISOString():'',bidIncrement:value.bidIncrement,vaultRevision:source.revision,usaAttestedAt:value.usaAttest===true?stamp:'',fulfillment:value.fulfillment,pickupCity:value.pickupCity,pickupState:value.pickupState}),
   db.insert(listingInventory).select(db.select({sellerId:sql<string>`${me.id}`.as('seller_id'),bookId:sql<string>`json_extract(item.value, '$.bookId')`.as('book_id'),listingId:sql<string>`${listingId}`.as('listing_id')}).from(sql`json_each(${JSON.stringify(items)}) item`).where(sql`true`)),
   checked.finish
  ]);
 }catch(error){if(marketplaceGuardFailed(error)||/listing_inventory/.test(databaseMessage(error)))throw new ApiRequestError('A selected copy is already listed or your collection changed. Refresh before publishing.',409);throw error}
 return {listingId};
}

async function resultFor(db:Db,row:ListingRow,me:Profile,duplicate:boolean){const context=await listingContext(db,[row],me.id);return {saved:true,duplicate,listingId:row.id,auction:auctionView(row,me.id,context.ownBids.get(row.id)),note:'Nonbinding private preview only. No order, payment or transfer was created.'}}
export async function placeBid(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=z.object({listingId:z.string().trim().min(1).max(100),amount:cents,requestId:z.string().uuid(),nonbindingConsent:z.literal(true)}).parse(raw);
 const [record]=await db.select().from(auctionBids).where(and(eq(auctionBids.bidderId,me.id),eq(auctionBids.requestId,value.requestId)));
 if(record){if(record.listingId!==value.listingId||record.amount!==value.amount)throw new ApiRequestError('This bid request was already used for a different proposal.',409);const [row]=await db.select().from(listings).where(eq(listings.id,record.listingId));if(!row)throw new ApiRequestError('Auction preview not found.',404);return resultFor(db,row,me,true)}
 const [row]=await db.select().from(listings).where(eq(listings.id,value.listingId));
 if(!row)throw new ApiRequestError('Auction preview not found.',404);
 if(row.saleType!=='auction')throw new ApiRequestError('Fixed-price listings cannot receive auction proposals.',400);
 if(row.sellerId===me.id)throw new ApiRequestError('You cannot bid on your own auction preview.',403);
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,row.sellerId));
 if(!me.visible||!seller?.visible||seller.moderated||await isRestricted(db,seller.userId))throw new ApiRequestError('Both eligible collector showcases must be visible to participate.',403);
 if(await blocked(db,me.id,row.sellerId))throw new ApiRequestError('Bidding is unavailable for this collector.',403);
 if(row.status!=='active'||!Number.isFinite(Date.parse(row.endAt))||Date.parse(row.endAt)<=Date.now())throw new ApiRequestError('This auction preview has ended.',409);
 const minimum=row.currentBid===null?row.price:row.currentBid+row.bidIncrement;
 if(value.amount<minimum)throw new ApiRequestError('Your proposal must meet the current minimum bid. Refresh the auction preview.',400);
 const stamp=new Date().toISOString(),bidId=crypto.randomUUID();
 const checked=guard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN profiles seller ON seller.id = l.seller_id
  JOIN profiles bidder ON bidder.id = ${me.id} WHERE l.id = ${row.id} AND l.sale_type = 'auction'
   AND l.status = 'active' AND parse_iso_timestamp(l.end_at) IS NOT NULL AND l.end_at > ${stamp}
   AND l.auction_version = ${row.auctionVersion} AND ${value.amount} >= COALESCE(l.current_bid + l.bid_increment,l.price)
   AND l.seller_id != bidder.id AND bidder.user_id = ${me.userId}
   AND seller.visible = 1 AND seller.moderated = 0 AND bidder.visible = 1 AND bidder.moderated = 0
   AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (seller.user_id,bidder.user_id))
   AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = bidder.id AND b.to_id = seller.id) OR (b.from_id = seller.id AND b.to_id = bidder.id)))`);
 try{await db.batch([
  checked.start,
  db.update(auctionBids).set({status:'outbid'}).where(and(eq(auctionBids.listingId,row.id),eq(auctionBids.status,'leading'))),
  db.insert(auctionBids).values({id:bidId,listingId:row.id,bidderId:me.id,requestId:value.requestId,amount:value.amount,status:'leading',sequence:row.auctionVersion+1,createdAt:stamp,rulesVersion:previewRulesVersion}),
  db.update(listings).set({currentBid:value.amount,leaderId:me.id,leadingBidId:bidId,bidCount:sql`${listings.bidCount} + 1`,auctionVersion:sql`${listings.auctionVersion} + 1`}).where(eq(listings.id,row.id)),
  checked.finish
 ])}
 catch(error){const [repeat]=await db.select().from(auctionBids).where(and(eq(auctionBids.bidderId,me.id),eq(auctionBids.requestId,value.requestId)));if(repeat){if(repeat.listingId!==value.listingId||repeat.amount!==value.amount)throw new ApiRequestError('This bid request was already used for a different proposal.',409);const [fresh]=await db.select().from(listings).where(eq(listings.id,row.id));return resultFor(db,fresh,me,true)}if(marketplaceGuardFailed(error))throw new ApiRequestError('The auction changed while bidding. Refresh and review the new minimum.',409);throw error}
 const [fresh]=await db.select().from(listings).where(eq(listings.id,row.id));return resultFor(db,fresh,me,false);
}
export async function retractBid(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=z.object({listingId:z.string().trim().min(1).max(100),bidId:z.string().uuid(),nonbindingConsent:z.literal(true)}).parse(raw);
 const [bid]=await db.select().from(auctionBids).where(and(eq(auctionBids.id,value.bidId),eq(auctionBids.listingId,value.listingId),eq(auctionBids.bidderId,me.id)));
 if(!bid)throw new ApiRequestError('Your bid record was not found.',404);
 const [row]=await db.select().from(listings).where(eq(listings.id,bid.listingId));
 if(!row||row.status!=='active'||!Number.isFinite(Date.parse(row.endAt))||Date.parse(row.endAt)<=Date.now())throw new ApiRequestError('Bids cannot be retracted after the auction preview ends.',409);
 if(bid.status==='retracted')return resultFor(db,row,me,true);
 if(!['leading','outbid'].includes(bid.status))throw new ApiRequestError('This bid record cannot be retracted.',409);
 const [latest]=await db.select({id:auctionBids.id}).from(auctionBids).where(and(eq(auctionBids.listingId,bid.listingId),eq(auctionBids.bidderId,me.id),inArray(auctionBids.status,['leading','outbid']))).orderBy(sql`${auctionBids.sequence} DESC`).limit(1);
 if(latest?.id!==bid.id)throw new ApiRequestError('Retract your latest unretracted proposal first.',409);
 const stamp=new Date().toISOString();
 const checked=guard(db,sql`EXISTS (SELECT 1 FROM auction_bids own JOIN listings l ON l.id = own.listing_id
  WHERE own.id = ${bid.id} AND own.bidder_id = ${me.id} AND own.listing_id = ${row.id}
   AND own.status IN ('leading','outbid') AND l.status = 'active' AND parse_iso_timestamp(l.end_at) IS NOT NULL
   AND l.end_at > ${stamp} AND l.auction_version = ${row.auctionVersion}
   AND own.id = (SELECT latest.id FROM auction_bids latest WHERE latest.listing_id = own.listing_id
    AND latest.bidder_id = own.bidder_id AND latest.status IN ('leading','outbid') ORDER BY latest.sequence DESC LIMIT 1))`);
 try{await db.batch([
  checked.start,
  db.update(listings).set({currentBid:sql`CASE WHEN ${listings.leadingBidId} = ${bid.id} THEN NULL ELSE ${listings.currentBid} END`,leaderId:sql`CASE WHEN ${listings.leadingBidId} = ${bid.id} THEN NULL ELSE ${listings.leaderId} END`,leadingBidId:sql`CASE WHEN ${listings.leadingBidId} = ${bid.id} THEN NULL ELSE ${listings.leadingBidId} END`,auctionVersion:sql`${listings.auctionVersion} + 1`}).where(eq(listings.id,row.id)),
  db.update(auctionBids).set({status:'retracted',retractedAt:stamp,retractedVersion:row.auctionVersion+1}).where(eq(auctionBids.id,bid.id)),
  checked.finish
 ])}
 catch(error){if(marketplaceGuardFailed(error))throw new ApiRequestError('The auction changed while retracting. Refresh and retry.',409);throw error}
 const [fresh]=await db.select().from(listings).where(eq(listings.id,row.id));return resultFor(db,fresh,me,false);
}

type TradeRow=typeof tradeProposals.$inferSelect;
type TradeContext={people:Map<string,Profile>;sources:Map<string,typeof collections.$inferSelect>;vaults:Map<string,Vault>;listingRows:Map<string,ListingRow>;reserved:Set<string>;restricted:Set<string>;blocked:boolean};
const tradeItemsSchema=z.array(z.object({id:bookId,bookId,title:z.string().max(200),issue:z.string().max(40),grade:z.string().max(100),catalogId:z.number().int().min(0).optional(),externalCatalog:externalCatalogSchema.optional(),photoId:z.string().uuid().optional(),condition:conditionSchema.optional()}).strict()).min(1).max(1000);
function tradeItems(raw:string):ListingItem[]{try{return tradeItemsSchema.parse(JSON.parse(raw))}catch{throw new ApiRequestError('These saved trade terms need review before they can be used.',409)}}
function coreTradeItem(item:ListingItem){const {condition,...core}=item;void condition;return core}
function publicTradeItems(raw:string){return tradeItems(raw).map(({photoId,...item})=>{void photoId;return item})}
function tradeListingSnapshot(row:ListingRow){return JSON.stringify({title:row.title,grade:row.grade,description:row.description,kind:row.kind,saleType:row.saleType,items:row.items,photos:row.photos,cert:row.cert,price:row.price,shipping:row.shipping,fulfillment:row.fulfillment,pickupCity:row.pickupCity,pickupState:row.pickupState})}
async function tradeContext(db:Db,rows:TradeRow[],a:string,b:string):Promise<TradeContext>{
 const people=new Map<string,Profile>(),sources=new Map<string,typeof collections.$inferSelect>(),vaults=new Map<string,Vault>(),listingRows=new Map<string,ListingRow>(),reserved=new Set<string>(),restricted=new Set<string>();
 for(const actor of await db.select().from(profiles).where(inArray(profiles.id,[a,b])))people.set(actor.id,actor);
 const userIds=[...people.values()].map(actor=>actor.userId);
 if(userIds.length){for(const source of await db.select().from(collections).where(inArray(collections.userId,userIds))){sources.set(source.userId,source);vaults.set(source.userId,vaultSchema.parse(JSON.parse(source.data)))}for(const restriction of await db.select().from(accountRestrictions).where(and(inArray(accountRestrictions.userId,userIds),eq(accountRestrictions.scope,'account'))))restricted.add(restriction.userId)}
 for(const batch of chunks([...new Set(rows.map(row=>row.listingId))]))for(const listing of await db.select().from(listings).where(inArray(listings.id,batch)))listingRows.set(listing.id,listing);
 const held=await db.select({sellerId:listingInventory.sellerId,bookId:listingInventory.bookId}).from(listingInventory).where(and(inArray(listingInventory.sellerId,[a,b]),sql`(EXISTS (SELECT 1 FROM listings held WHERE held.id = ${listingInventory.listingId} AND held.status = 'active') OR EXISTS (SELECT 1 FROM commerce_orders paid WHERE paid.listing_id = ${listingInventory.listingId} AND paid.status NOT IN ('cancelled','checkout_expired')))`));
 for(const copy of held)reserved.add(copy.sellerId+':'+copy.bookId);
 return {people,sources,vaults,listingRows,reserved,restricted,blocked:await blocked(db,a,b)};
}
function tradeUnavailable(row:TradeRow,context:TradeContext):string|null{
 const buyer=context.people.get(row.buyerId),seller=context.people.get(row.sellerId),listing=context.listingRows.get(row.listingId);
 if(!buyer||!seller||[buyer,seller].some(actor=>!actor.visible||!actor.dmOpen||actor.moderated||actor.deletionStartedAt||context.restricted.has(actor.userId)))return 'A collector is no longer available for this agreement.';
 if([buyer,seller].some(actor=>actor.rulesVersion!==previewRulesVersion||!actor.rulesAcceptedAt))return 'Both collectors must accept the current collector rules before agreeing.';
 if(context.blocked)return 'Messaging is blocked between these collectors.';
 if(!listing||listing.status!=='active'||listing.saleType!=='fixed'||listing.sellerId!==seller.id)return 'The target listing is no longer available.';
 if(tradeListingSnapshot(listing)!==row.listingSnapshot)return 'The target listing details changed. Propose fresh terms.';
 const buyerBooks=new Map(context.vaults.get(buyer.userId)?.books.map(copy=>[copy.id,copy])||[]),sellerBooks=new Map(context.vaults.get(seller.userId)?.books.map(copy=>[copy.id,copy])||[]);
 for(const [raw,owned] of [[row.buyerItems,buyerBooks],[row.sellerItems,sellerBooks]] as const)for(const item of tradeItems(raw)){const current=owned.get(item.bookId);if(!current||JSON.stringify(snapshot(current))!==JSON.stringify(coreTradeItem(item)))return 'An included owned copy changed or was removed. Propose fresh terms.'}
 if(tradeItems(row.buyerItems).some(item=>context.reserved.has(buyer.id+':'+item.bookId)))return 'An offered copy is reserved in another listing or order.';
 return null;
}
function tradeProposalDto(row:TradeRow,viewerId:string,context:TradeContext):TradeProposal{
 if(row.status!=='pending'&&row.status!=='accepted'&&row.status!=='declined'&&row.status!=='cancelled')throw new ApiRequestError('These saved trade terms need review.',409);
 const role=row.buyerId===viewerId?'buyer':'seller',pending=row.status==='pending',reason=pending?tradeUnavailable(row,context):null,person=(id:string)=>{const p=context.people.get(id);return {id,name:p?.name||'Former collector',handle:p?.handle||''}};
 const actor=context.people.get(viewerId),canEnd=!!actor&&!actor.deletionStartedAt&&pending;
 let listingTitle:string;try{listingTitle=String(JSON.parse(row.listingSnapshot).title||'Comic listing')}catch{throw new ApiRequestError('These saved trade terms need review.',409)}
 return {id:row.id,threadId:row.threadId,listingId:row.listingId,listingTitle,buyer:person(row.buyerId),seller:person(row.sellerId),offeredItems:publicTradeItems(row.buyerItems),requestedItems:publicTradeItems(row.sellerItems),status:row.status,version:row.version,role,createdAt:row.createdAt,updatedAt:row.updatedAt,decidedAt:row.decidedAt,canAccept:pending&&role==='seller'&&!reason,canDecline:canEnd&&role==='seller',canCancel:canEnd&&role==='buyer',unavailableReason:reason,agreementOnly:true,completed:false,protected:false};
}
export async function readTradeTerms(db:Db,me:Profile|undefined,threadId:string,cursor?:string):Promise<TradeTermsData>{
 if(!me)throw new ApiRequestError('Create your free collector profile first.',403);
 const [thread]=await db.select().from(threads).where(eq(threads.id,threadId));if(!thread||![thread.a,thread.b].includes(me.id))throw new ApiRequestError('Conversation not found.',404);
 let before:SQL|undefined;
 if(cursor){const [anchor]=await db.select().from(tradeProposals).where(and(eq(tradeProposals.id,z.string().uuid().parse(cursor)),eq(tradeProposals.threadId,thread.id),or(eq(tradeProposals.buyerId,me.id),eq(tradeProposals.sellerId,me.id))));if(!anchor)throw new ApiRequestError('Trade terms page not found.',404);before=or(lt(tradeProposals.createdAt,anchor.createdAt),and(eq(tradeProposals.createdAt,anchor.createdAt),lt(tradeProposals.id,anchor.id)))}
 const rows=await db.select().from(tradeProposals).where(and(eq(tradeProposals.threadId,thread.id),inArray(tradeProposals.buyerId,[thread.a,thread.b]),inArray(tradeProposals.sellerId,[thread.a,thread.b]),before)).orderBy(desc(tradeProposals.createdAt),desc(tradeProposals.id)).limit(11),shown=rows.slice(0,10),context=await tradeContext(db,shown,thread.a,thread.b);
 return {proposals:shown.map(row=>tradeProposalDto(row,me.id,context)),hasMore:rows.length>10,nextCursor:rows.length>10?shown.at(-1)!.id:null};
}
export async function tradeTermsAccountData(db:Db,profileId:string){
 const rows=await db.select().from(tradeProposals).where(or(eq(tradeProposals.buyerId,profileId),eq(tradeProposals.sellerId,profileId))).orderBy(desc(tradeProposals.createdAt),desc(tradeProposals.id));
 return rows.map(row=>({id:row.id,threadId:row.threadId,listingId:row.listingId,buyerId:row.buyerId,sellerId:row.sellerId,offeredItems:publicTradeItems(row.buyerItems),requestedItems:publicTradeItems(row.sellerItems),status:row.status,version:row.version,createdAt:row.createdAt,updatedAt:row.updatedAt,decidedAt:row.decidedAt,agreementOnly:true,completed:false,protected:false}));
}
// A durable proposal is separate from its ordinary chat message. Neither record
// charges, reserves or transfers a book; acceptance records agreed terms only.
export async function proposeListingTrade(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=z.object({action:z.literal('trade_offer'),listingId:z.string().min(1).max(100),bookIds:z.array(bookId).min(1).max(10).refine(ids=>new Set(ids).size===ids.length),note:z.string().trim().max(300).default(''),requestId:z.string().uuid()}).strict().parse(raw),requestBody=JSON.stringify({listingId:value.listingId,bookIds:value.bookIds,note:value.note});
 const [existing]=await db.select().from(tradeProposals).where(eq(tradeProposals.id,value.requestId));
 if(existing){if(existing.buyerId!==me.id||existing.requestBody!==requestBody)throw new ApiRequestError('This request was already used for different trade terms.',409);const [thread]=await db.select().from(threads).where(eq(threads.id,existing.threadId));if(!thread||![thread.a,thread.b].includes(me.id))throw new ApiRequestError('Conversation not found.',404);return {saved:true,proposalId:existing.id,threadId:existing.threadId,duplicate:true,note:'These saved trade terms already exist. No new message or trade was created.'}}
 const [listing]=await db.select().from(listings).where(eq(listings.id,value.listingId));
 if(!listing||listing.status!=='active'||listing.saleType!=='fixed'||listing.sellerId===me.id)throw new ApiRequestError('This listing cannot receive your trade proposal.',409);
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));
 if(!seller?.visible||!seller.dmOpen||seller.moderated||seller.deletionStartedAt||!me.visible||!me.dmOpen||me.moderated||me.deletionStartedAt||await isRestricted(db,seller.userId)||await blocked(db,me.id,seller.id))throw new ApiRequestError('Both collectors must be available for private trade messages.',403);
 const [source]=await db.select().from(collections).where(eq(collections.userId,me.userId)),[sellerSource]=await db.select().from(collections).where(eq(collections.userId,seller.userId));
 if(!source||!sellerSource)throw new ApiRequestError('Both collectors must still own the included copies.',409);
 const vault=vaultSchema.parse(JSON.parse(source.data)),owned=new Map(vault.books.map(book=>[book.id,book])),sellerVault=vaultSchema.parse(JSON.parse(sellerSource.data)),sellerOwned=new Map(sellerVault.books.map(book=>[book.id,book])),requested=listingItems(listing);
 if(value.bookIds.some(id=>!owned.has(id)))throw new ApiRequestError('Choose only copies in your own current collection.',403);
 if(!requested.length||requested.some(item=>!sellerOwned.has(item.bookId)||JSON.stringify(snapshot(sellerOwned.get(item.bookId)!))!==JSON.stringify(coreTradeItem(item))))throw new ApiRequestError('The seller copies changed. The seller must update the listing before proposing terms.',409);
 const offered=value.bookIds.map(id=>snapshot(owned.get(id)!)),buyerItems=JSON.stringify(offered),sellerItems=JSON.stringify(requested),listingSnapshot=tradeListingSnapshot(listing);
 const short=(text:string,max:number)=>text.replace(/[\r\n\t]+/g,' ').slice(0,max);
 const body=['TRADE PROPOSAL: '+short(listing.title,140),'I would like to discuss exchanging these owned copies for your '+(listing.kind==='collection'?'entire listed collection':'listed comic')+':',...value.bookIds.map((id,index)=>{const book=owned.get(id)!;return `${index+1}. ${short(book.title,70)} ${short(book.issue,18)} · ${short(book.grade||'Condition not recorded',30)}`}),...(value.note?['My note: '+value.note]:[]),'Use the trade terms card to accept, decline or cancel. A conversation agreement does not complete or protect a trade. No payment or inventory transfer occurs.'].join('\n');
 if(body.length>2000)throw new ApiRequestError('Shorten your trade note before sending.',400);
 const [a,b]=[me.id,seller.id].sort(),pair=a+':'+b,stamp=new Date().toISOString(),selected=JSON.stringify(value.bookIds);
 const checked=guard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN profiles seller ON seller.id = l.seller_id JOIN profiles buyer ON buyer.id = ${me.id} JOIN collections c ON c.user_id = buyer.user_id JOIN collections seller_vault ON seller_vault.user_id = seller.user_id
  WHERE l.id = ${listing.id} AND l.status = 'active' AND l.sale_type = 'fixed' AND seller.id = ${seller.id} AND l.seller_id != buyer.id AND buyer.user_id = ${me.userId}
   AND c.revision = ${source.revision} AND c.data = ${source.data} AND seller_vault.revision = ${sellerSource.revision} AND seller_vault.data = ${sellerSource.data} AND l.items = ${listing.items} AND l.photos = ${listing.photos} AND l.description = ${listing.description} AND l.price = ${listing.price} AND l.shipping = ${listing.shipping} AND l.fulfillment = ${listing.fulfillment} AND l.title = ${listing.title} AND l.grade = ${listing.grade} AND l.kind = ${listing.kind} AND l.cert = ${listing.cert} AND l.pickup_city = ${listing.pickupCity} AND l.pickup_state = ${listing.pickupState}
   AND buyer.visible = 1 AND buyer.dm_open = 1 AND seller.visible = 1 AND seller.dm_open = 1
   AND buyer.moderated = 0 AND seller.moderated = 0 AND buyer.deletion_started_at IS NULL AND seller.deletion_started_at IS NULL
   AND buyer.rules_version = ${previewRulesVersion} AND buyer.rules_accepted_at != ''
   AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (buyer.user_id,seller.user_id))
   AND NOT EXISTS (SELECT 1 FROM blocks block WHERE (block.from_id = buyer.id AND block.to_id = seller.id) OR (block.from_id = seller.id AND block.to_id = buyer.id))
   AND NOT EXISTS (SELECT 1 FROM listing_inventory reserved WHERE reserved.seller_id = buyer.id AND reserved.book_id IN (SELECT item.value FROM json_each(${selected}) item)
    AND (EXISTS (SELECT 1 FROM listings occupied WHERE occupied.id = reserved.listing_id AND occupied.status = 'active') OR EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = reserved.listing_id AND o.status NOT IN ('cancelled','checkout_expired')))))
  AND NOT EXISTS (SELECT 1 FROM trade_proposals used WHERE used.id = ${value.requestId} AND NOT (used.buyer_id = ${me.id} AND used.seller_id = ${seller.id} AND used.request_body = ${requestBody} AND used.buyer_items = ${buyerItems} AND used.seller_items = ${sellerItems} AND used.listing_snapshot = ${listingSnapshot}))
  AND NOT EXISTS (SELECT 1 FROM messages used WHERE used.id = ${value.requestId} AND NOT (used.profile_id = ${me.id} AND used.body = ${body} AND used.thread_id = (SELECT t.id FROM threads t WHERE t.pair = ${pair})))
  AND (NOT EXISTS (SELECT 1 FROM trade_proposals existing WHERE existing.id = ${value.requestId}) OR EXISTS (SELECT 1 FROM messages existing WHERE existing.id = ${value.requestId}))`);
 let inserted=false;
 try{const results=await db.batch([
  checked.start,
  db.insert(threads).values({id:crypto.randomUUID(),pair,a,b,context:'Trade discussion: '+listing.title,createdAt:stamp}).onConflictDoNothing(),
  db.insert(tradeProposals).select(db.select({id:sql<string>`${value.requestId}`.as('id'),threadId:threads.id,listingId:sql<string>`${listing.id}`.as('listing_id'),buyerId:sql<string>`${me.id}`.as('buyer_id'),sellerId:sql<string>`${seller.id}`.as('seller_id'),status:sql<string>`'pending'`.as('status'),version:sql<number>`0`.as('version'),requestBody:sql<string>`${requestBody}`.as('request_body'),buyerItems:sql<string>`${buyerItems}`.as('buyer_items'),sellerItems:sql<string>`${sellerItems}`.as('seller_items'),listingSnapshot:sql<string>`${listingSnapshot}`.as('listing_snapshot'),createdAt:sql<string>`${stamp}`.as('created_at'),updatedAt:sql<string>`${stamp}`.as('updated_at'),decidedAt:sql<null>`NULL`.as('decided_at'),decidedBy:sql<null>`NULL`.as('decided_by')}).from(threads).where(eq(threads.pair,pair))).onConflictDoNothing().returning({id:tradeProposals.id}),
  db.insert(messages).select(db.select({id:sql<string>`${value.requestId}`.as('id'),threadId:threads.id,profileId:sql<string>`${me.id}`.as('profile_id'),body:sql<string>`${body}`.as('body'),createdAt:sql<string>`${stamp}`.as('created_at')}).from(threads).where(eq(threads.pair,pair))).onConflictDoNothing(),
  checked.finish
 ]);inserted=Array.isArray(results[2])&&results[2].length>0}catch(error){if(marketplaceGuardFailed(error))throw new ApiRequestError('The listing, available copies or messaging permissions changed. Refresh before sending a trade proposal.',409);throw error}
 const [thread]=await db.select().from(threads).where(eq(threads.pair,pair));
 return {saved:true,proposalId:value.requestId,threadId:thread.id,duplicate:!inserted,note:'Trade terms saved for the seller. Acceptance records an agreement only; no completed trade, protection, payment or transfer is created.'};
}
export async function decideTradeTerms(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=z.object({action:z.literal('trade_terms_decision'),proposalId:z.string().uuid(),decision:z.enum(['accept','decline','cancel']),expectedVersion:z.number().int().min(0),agreementOnlyConsent:z.literal(true).optional()}).strict().parse(raw);
 if(value.decision==='accept'&&value.agreementOnlyConsent!==true)throw new ApiRequestError('Confirm that accepting records terms only, without a completed or protected trade.',400);
 const [row]=await db.select().from(tradeProposals).where(eq(tradeProposals.id,value.proposalId));if(!row||![row.buyerId,row.sellerId].includes(me.id))throw new ApiRequestError('Trade proposal not found.',404);
 const seller=value.decision!=='cancel';if(seller?row.sellerId!==me.id:row.buyerId!==me.id)throw new ApiRequestError('Only the seller may accept or decline; only the proposer may cancel.',403);
 if(row.status!=='pending'||row.version!==value.expectedVersion)throw new ApiRequestError('These trade terms already changed. Refresh before deciding.',409);
 const context=await tradeContext(db,[row],row.buyerId,row.sellerId),accept=value.decision==='accept',reason=accept?tradeUnavailable(row,context):null;
 if(reason)throw new ApiRequestError(reason,409);
 const buyer=context.people.get(row.buyerId),owner=context.people.get(row.sellerId),buyerSource=buyer?context.sources.get(buyer.userId):undefined,sellerSource=owner?context.sources.get(owner.userId):undefined,listing=context.listingRows.get(row.listingId),selected=JSON.stringify(tradeItems(row.buyerItems).map(item=>item.bookId));
 const permission=accept&&buyer&&owner&&buyerSource&&sellerSource&&listing?sql`EXISTS (SELECT 1 FROM profiles buyer JOIN profiles seller ON seller.id = ${row.sellerId} JOIN collections buyer_vault ON buyer_vault.user_id = buyer.user_id JOIN collections seller_vault ON seller_vault.user_id = seller.user_id JOIN listings l ON l.id = ${row.listingId}
  WHERE buyer.id = ${row.buyerId} AND l.seller_id = seller.id AND l.status = 'active' AND l.sale_type = 'fixed' AND l.items = ${listing.items} AND l.photos = ${listing.photos} AND l.description = ${listing.description} AND l.price = ${listing.price} AND l.shipping = ${listing.shipping} AND l.fulfillment = ${listing.fulfillment} AND l.pickup_city = ${listing.pickupCity} AND l.pickup_state = ${listing.pickupState} AND l.title = ${listing.title} AND l.grade = ${listing.grade} AND l.kind = ${listing.kind} AND l.cert = ${listing.cert}
   AND buyer_vault.revision = ${buyerSource.revision} AND buyer_vault.data = ${buyerSource.data} AND seller_vault.revision = ${sellerSource.revision} AND seller_vault.data = ${sellerSource.data} AND buyer.visible = 1 AND seller.visible = 1 AND buyer.dm_open = 1 AND seller.dm_open = 1 AND buyer.moderated = 0 AND seller.moderated = 0 AND buyer.deletion_started_at IS NULL AND seller.deletion_started_at IS NULL
   AND buyer.rules_version = ${previewRulesVersion} AND seller.rules_version = ${previewRulesVersion} AND buyer.rules_accepted_at != '' AND seller.rules_accepted_at != ''
   AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (buyer.user_id,seller.user_id))
   AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = buyer.id AND b.to_id = seller.id) OR (b.from_id = seller.id AND b.to_id = buyer.id))
   AND NOT EXISTS (SELECT 1 FROM listing_inventory reserved WHERE reserved.seller_id = buyer.id AND reserved.book_id IN (SELECT copy.value FROM json_each(${selected}) copy) AND (EXISTS (SELECT 1 FROM listings held WHERE held.id = reserved.listing_id AND held.status = 'active') OR EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = reserved.listing_id AND o.status NOT IN ('cancelled','checkout_expired')))))`:accept?sql`false`:sql`true`;
 const stamp=new Date().toISOString(),status=value.decision==='accept'?'accepted':value.decision==='decline'?'declined':'cancelled',checked=guard(db,sql`EXISTS (SELECT 1 FROM trade_proposals pending JOIN threads t ON t.id = pending.thread_id JOIN profiles actor ON actor.id = ${me.id}
  WHERE pending.id = ${row.id} AND pending.status = 'pending' AND pending.version = ${value.expectedVersion} AND pending.listing_id = ${row.listingId} AND pending.request_body = ${row.requestBody} AND pending.created_at = ${row.createdAt} AND pending.buyer_id = ${row.buyerId} AND pending.seller_id = ${row.sellerId} AND pending.thread_id = ${row.threadId} AND pending.buyer_items = ${row.buyerItems} AND pending.seller_items = ${row.sellerItems} AND pending.listing_snapshot = ${row.listingSnapshot}
   AND actor.user_id = ${me.userId} AND actor.deletion_started_at IS NULL AND ((t.a = pending.buyer_id AND t.b = pending.seller_id) OR (t.b = pending.buyer_id AND t.a = pending.seller_id))) AND ${permission}`);
 try{await db.batch([checked.start,db.update(tradeProposals).set({status,version:sql`${tradeProposals.version} + 1`,updatedAt:stamp,decidedAt:stamp,decidedBy:me.id}).where(eq(tradeProposals.id,row.id)),checked.finish])}catch(error){if(marketplaceGuardFailed(error))throw new ApiRequestError('The proposal, copies or collector permissions changed while deciding. Refresh the terms.',409);throw error}
 return {saved:true,proposalId:row.id,threadId:row.threadId,status,note:status==='accepted'?'Agreement recorded only. No completed trade, protection, payment or transfer was created.':'Trade proposal '+status+'. No payment or transfer was created.'};
}

export async function checkMarketplaceDeletion(db:Db,me:Profile){
 const credit=await db.execute(sql`SELECT 1 FROM ch_web.reward_accounts WHERE user_id=${me.userId} AND (credit_cents>0 OR reserved_cents>0 OR points_balance<>0) LIMIT 1`);
 if(credit.rows.length)throw new ApiRequestError('Contact support to resolve your on-site credit and reward history before removing the account.',409);
 const custody=await db.execute(sql`SELECT id FROM ch_web.safe_purchase_requests WHERE (buyer_user_id=${me.userId} OR seller_user_id=${me.userId}) AND status IN ('accepted','received_at_vault','inspected','shipped_to_buyer') LIMIT 1`);
 if(custody.rows.length)throw new ApiRequestError('Resolve your active SafePurchase inspection or shipment before account removal. Contact maliktecks@gmail.com for custody review.',409);
 const [orderHistory]=await db.select({id:commerceOrders.id}).from(commerceOrders).where(or(eq(commerceOrders.buyerUserId,me.userId),eq(commerceOrders.sellerUserId,me.userId))).limit(1);
 if(orderHistory)throw new ApiRequestError('Ask support at maliktecks@gmail.com to review your sandbox order and refund records before removing your account. Financial history is not silently deleted.',409);
 const [sellerHistory]=await db.select({id:listings.id}).from(listings).where(and(eq(listings.sellerId,me.id),eq(listings.saleType,'auction'),gt(listings.bidCount,0),inArray(listings.status,['active','ended']))).limit(1);
 if(sellerHistory)throw new ApiRequestError('Ask support at maliktecks@gmail.com to cancel your auction previews with bid history before deleting your account. No payment or order was created.',409);
 const [openBid]=await db.select({id:auctionBids.id}).from(auctionBids).innerJoin(listings,eq(listings.id,auctionBids.listingId)).where(and(eq(auctionBids.bidderId,me.id),inArray(auctionBids.status,['leading','outbid']),eq(listings.status,'active'),gt(listings.endAt,new Date().toISOString()))).limit(1);
 if(openBid)throw new ApiRequestError('Retract your proposals in open auction previews before deleting your account, or contact maliktecks@gmail.com for help.',409);
}
export function anonymizeMarketplaceHistory(db:Db,me:Profile){
 const removed='deleted:'+crypto.randomUUID(),stamp=new Date().toISOString();
 const sellerSafe=guard(db,sql`NOT EXISTS(SELECT 1 FROM ch_web.reward_accounts WHERE user_id=${me.userId} AND (credit_cents>0 OR reserved_cents>0 OR points_balance<>0)) AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.buyer_user_id = ${me.userId} OR o.seller_user_id = ${me.userId}) AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = ${me.id} AND l.sale_type = 'auction' AND l.bid_count > 0 AND l.status IN ('active','ended')) AND NOT EXISTS(SELECT 1 FROM ch_web.safe_purchase_requests r WHERE (r.buyer_user_id=${me.userId} OR r.seller_user_id=${me.userId}) AND r.status IN ('accepted','received_at_vault','inspected','shipped_to_buyer'))`);
 const bidderSafe=guard(db,sql`NOT EXISTS (SELECT 1 FROM auction_bids b JOIN listings l ON l.id = b.listing_id WHERE b.bidder_id = ${me.id} AND b.status IN ('leading','outbid') AND l.status = 'active' AND parse_iso_timestamp(l.end_at) IS NOT NULL AND l.end_at > ${stamp})`);
 return {checks:[sellerSafe.start,bidderSafe.start],before:[
  db.update(profiles).set({deletionStartedAt:stamp,visible:0,dmOpen:0}).where(eq(profiles.id,me.id)),
  db.execute(sql`DELETE FROM ch_web.safe_purchase_requests WHERE buyer_user_id=${me.userId} OR seller_user_id=${me.userId}`),
  db.execute(sql`DELETE FROM ch_web.reward_ledger WHERE user_id=${me.userId}`),
  db.execute(sql`DELETE FROM ch_web.reward_accounts WHERE user_id=${me.userId}`),
  db.update(auctionBids).set({bidderId:removed,requestId:sql`${auctionBids.id}`}).where(eq(auctionBids.bidderId,me.id)),
  db.update(listings).set({leaderId:null}).where(eq(listings.leaderId,me.id)),
  db.update(listings).set({sellerId:removed,title:'Cancelled preview · seller account removed',description:'Historical nonbinding preview. The seller removed their account.',photos:'[]',items:'[]',itemCount:0,bookId:'deleted',issueId:null,grade:'',cert:'',vaultRevision:'',usaAttestedAt:'',fulfillment:'shipping',pickupCity:'',pickupState:'',locationZip:'',locationCity:'',locationState:'',latitude:null,longitude:null,safePurchaseOptIn:0,safePurchaseVerifiedAt:null}).where(and(eq(listings.sellerId,me.id),eq(listings.saleType,'auction'),gt(listings.bidCount,0),eq(listings.status,'cancelled'))),
  db.delete(listingInventory).where(eq(listingInventory.sellerId,me.id))
 ],after:[sellerSafe.finish,bidderSafe.finish]};
}
