// Binding auctions: proxy bids, reserve, resolution and the winner's payment window.
// Listings created before 026 have no terms row and stay legacy nonbinding previews.
import {and,eq,inArray,sql} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '../db';
import {auctionBids,listingInventory,listings,offers,profiles} from '../db/schema';
import {ApiRequestError,chunks,isRestricted} from './api-security';
import {blocked} from './conversations';
import {previewRulesVersion,type ListingAuction} from './community';
import {conditionalGuard,operationGuardFailed} from './operation-guard';
import {AUCTION_PAYMENT_WINDOW_HOURS,applyProxyBid,bidIncrement,maskHandle,minimumBid,reserveMet,resolveAuction,type ProxyState} from './auction-engine';

type Db=ReturnType<typeof getDb>;
type ListingRow=typeof listings.$inferSelect;
type Profile=typeof profiles.$inferSelect;
export type AuctionTerms={listingId:string;reserveCents:number|null;result:''|'no_bids'|'reserve_not_met'|'awaiting_payment'|'paid'|'unpaid';winnerId:string|null;winningCents:number|null;resolvedAt:string|null;paymentDueAt:string|null};
export type AuctionDetails=Omit<ListingAuction,'nonbinding'>&{nonbinding:boolean;binding:boolean;reserve:'none'|'met'|'not_met';result:AuctionTerms['result'];youWon:boolean;paymentDueAt:string|null;winningCents:number|null;yourMax:number|null;nextIncrement:number|null};

let localSchema:Promise<void>|null=null;
/** Local PGlite only: applies 026 to an already-running dev database. Production uses migrations. */
export function ensureLocalAuctionSchema(db:Db){
 if(process.env.CH_LOCAL_DB!=='pglite'||process.env.NODE_ENV==='production')return Promise.resolve();
 localSchema??=(async()=>{const {readFile}=await import('node:fs/promises'),{resolve}=await import('node:path');const source=await readFile(resolve(process.cwd(),'db/postgres-migrations/026_binding_auctions.sql'),'utf8');for(const statement of source.replace(/--.*$/gm,'').split(';').map(part=>part.trim()).filter(Boolean))await db.execute(sql.raw(statement))})().catch(error=>{localSchema=null;throw error});
 return localSchema;
}
/** Before migration 026 is applied, every auction is a legacy preview: reads degrade instead of failing. */
export function missingAuctionTables(error:unknown){let current=error;for(let i=0;i<5&&current&&typeof current==='object';i++){const value=current as {code?:unknown;message?:unknown;cause?:unknown};if(value.code==='42P01'||typeof value.message==='string'&&/marketplace_auction_terms|auction_bid_maxes/.test(value.message)&&/does not exist/.test(value.message))return true;current=value.cause}return false}
let tablesReady=false;
export async function auctionTablesExist(db:Db){
 if(tablesReady)return true;
 await ensureLocalAuctionSchema(db).catch(()=>undefined);
 const result=await db.execute(sql`SELECT to_regclass('ch_web.marketplace_auction_terms') IS NOT NULL AS ready`);
 tablesReady=(result.rows[0] as {ready?:unknown}|undefined)?.ready===true;return tablesReady;
}
async function tolerant<T>(work:()=>Promise<T>,fallback:T):Promise<T>{try{return await work()}catch(error){if(missingAuctionTables(error))return fallback;throw error}}
function termsRow(row:Record<string,unknown>):AuctionTerms{return {listingId:String(row.listing_id),reserveCents:row.reserve_cents===null||row.reserve_cents===undefined?null:Number(row.reserve_cents),result:String(row.result||'') as AuctionTerms['result'],winnerId:row.winner_id?String(row.winner_id):null,winningCents:row.winning_cents===null||row.winning_cents===undefined?null:Number(row.winning_cents),resolvedAt:row.resolved_at?String(row.resolved_at):null,paymentDueAt:row.payment_due_at?String(row.payment_due_at):null}}
export async function auctionTerms(db:Db,listingIds:string[]):Promise<Map<string,AuctionTerms>>{
 const found=new Map<string,AuctionTerms>();if(!listingIds.length)return found;
 return tolerant(async()=>{await ensureLocalAuctionSchema(db);
 for(const batch of chunks([...new Set(listingIds)])){const result=await db.execute(sql`SELECT * FROM ch_web.marketplace_auction_terms WHERE listing_id IN (${sql.join(batch.map(id=>sql`${id}`),sql`, `)})`);for(const row of result.rows as Record<string,unknown>[])found.set(String(row.listing_id),termsRow(row))}
 return found;},found);
}
export function auctionTermsInsert(db:Db,listingId:string,reserveCents:number|null,stamp:string){return db.execute(sql`INSERT INTO ch_web.marketplace_auction_terms(listing_id,reserve_cents,result,created_at) VALUES(${listingId},${reserveCents},'',${stamp})`)}
async function leaderMax(db:Db,bidId:string|null){if(!bidId)return null;const result=await db.execute(sql`SELECT max_cents FROM ch_web.auction_bid_maxes WHERE bid_id=${bidId}`);const row=result.rows[0] as {max_cents?:unknown}|undefined;return row?Number(row.max_cents):null}
async function proxyState(db:Db,row:ListingRow,terms:AuctionTerms):Promise<ProxyState>{
 const max=row.leaderId&&row.leadingBidId?await leaderMax(db,row.leadingBidId):null;
 return {openingCents:row.price,reserveCents:terms.reserveCents,leader:row.leaderId&&row.leadingBidId&&max!==null?{bidderId:row.leaderId,maxCents:max,bidId:row.leadingBidId}:null,currentCents:row.currentBid};
}
export function bindingAuctionView(row:ListingRow,base:ListingAuction,terms:AuctionTerms|undefined,viewerId:string|undefined,viewerMax:number|null,stamp=Date.now()):AuctionDetails{
 if(!terms)return {...base,nonbinding:true,binding:false,reserve:'none',result:'',youWon:false,paymentDueAt:null,winningCents:null,yourMax:null,nextIncrement:null};
 const ended=base.ended||row.status!=='active',leaderIsViewer=!!viewerId&&row.leaderId===viewerId;
 const reserve=terms.reserveCents===null?'none':row.currentBid!==null&&row.currentBid>=terms.reserveCents?'met':'not_met';
 const next=row.currentBid===null?row.price:row.currentBid+bidIncrement(row.currentBid);
 return {...base,nonbinding:false,binding:true,bidIncrement:row.currentBid===null?bidIncrement(row.price):bidIncrement(row.currentBid),minNextBid:ended?null:next,leading:leaderIsViewer&&!ended?true:base.leading,reserve,result:terms.result,youWon:!!viewerId&&terms.winnerId===viewerId&&['awaiting_payment','paid'].includes(terms.result),paymentDueAt:viewerId&&terms.winnerId===viewerId||viewerId===row.sellerId?terms.paymentDueAt:null,winningCents:terms.result==='awaiting_payment'||terms.result==='paid'?terms.winningCents:null,yourMax:leaderIsViewer?viewerMax:null,nextIncrement:ended?null:bidIncrement(row.currentBid??row.price)};
}
export async function viewerMaxes(db:Db,listingIds:string[],viewerId:string|undefined){
 const found=new Map<string,number>();if(!viewerId||!listingIds.length)return found;
 return tolerant(async()=>{await ensureLocalAuctionSchema(db);
 for(const batch of chunks(listingIds)){const result=await db.execute(sql`SELECT m.listing_id,max(m.max_cents) AS max_cents FROM ch_web.auction_bid_maxes m WHERE m.bidder_id=${viewerId} AND m.listing_id IN (${sql.join(batch.map(id=>sql`${id}`),sql`, `)}) GROUP BY m.listing_id`);for(const row of result.rows as {listing_id:string;max_cents:unknown}[])found.set(row.listing_id,Number(row.max_cents))}
 return found;},found);
}

const bidSchema=z.object({listingId:z.string().trim().min(1).max(100),amount:z.number().int().min(100).max(100000000),requestId:z.string().uuid(),bindingConsent:z.literal(true,{errorMap:()=>({message:'Confirm that your bid is binding before bidding.'})})}).strict();
export type BindingBidResult={saved:true;duplicate:boolean;listingId:string;outcome:'leading'|'outbid'|'raised_max';currentBid:number|null;note:string};
/** Places a binding maximum bid. Serializable batch + auction_version CAS; conflicts re-read and retry. */
export async function placeBindingBid(db:Db,me:Profile,raw:Record<string,unknown>,terms:AuctionTerms):Promise<BindingBidResult>{
 const value=bidSchema.parse(raw);
 for(let attempt=0;attempt<5;attempt++){
  const [existing]=await db.select().from(auctionBids).where(and(eq(auctionBids.bidderId,me.id),eq(auctionBids.requestId,value.requestId)));
  if(existing){const max=await leaderMax(db,existing.id);if(existing.listingId!==value.listingId||max!==value.amount)throw new ApiRequestError('This bid request was already used for a different bid.',409);const [row]=await db.select().from(listings).where(eq(listings.id,existing.listingId));return {saved:true,duplicate:true,listingId:existing.listingId,outcome:row?.leaderId===me.id?'leading':'outbid',currentBid:row?.currentBid??null,note:'This bid was already recorded.'}}
  const [row]=await db.select().from(listings).where(eq(listings.id,value.listingId));
  if(!row||row.saleType!=='auction')throw new ApiRequestError('Auction not found.',404);
  if(row.sellerId===me.id)throw new ApiRequestError('You cannot bid on your own auction.',403);
  if(row.status!=='active'||!Number.isFinite(Date.parse(row.endAt))||Date.parse(row.endAt)<=Date.now())throw new ApiRequestError('This auction has ended. No more bids can be placed.',409);
  const [seller]=await db.select().from(profiles).where(eq(profiles.id,row.sellerId));
  if(!me.visible||!seller?.visible||seller.moderated||await isRestricted(db,seller.userId))throw new ApiRequestError('Both collector showcases must be visible to bid.',403);
  if(await blocked(db,me.id,row.sellerId))throw new ApiRequestError('Bidding is unavailable for this collector.',403);
  const state=await proxyState(db,row,terms),bidId=crypto.randomUUID(),applied=applyProxyBid(state,{bidderId:me.id,maxCents:value.amount,bidId});
  if(!applied.accepted)throw new ApiRequestError(applied.error==='not_above_own_max'?'You are already the highest bidder. To raise your maximum, enter more than your current maximum.':'Your maximum bid must be at least '+(minimumBid(state)/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+'.',400);
  const next=applied.state,stamp=new Date().toISOString(),leaderChanged=next.leader?.bidId===bidId;
  const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN profiles seller ON seller.id = l.seller_id JOIN profiles bidder ON bidder.id = ${me.id}
   WHERE l.id = ${row.id} AND l.sale_type = 'auction' AND l.status = 'active' AND l.end_at > ${stamp} AND l.auction_version = ${row.auctionVersion}
    AND l.seller_id != bidder.id AND bidder.user_id = ${me.userId} AND seller.visible = 1 AND seller.moderated = 0 AND bidder.visible = 1 AND bidder.moderated = 0
    AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (seller.user_id,bidder.user_id))
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = bidder.id AND b.to_id = seller.id) OR (b.from_id = seller.id AND b.to_id = bidder.id)))`);
  try{
   await db.batch([
    check.start,
    ...(leaderChanged?[db.update(auctionBids).set({status:'outbid'}).where(and(eq(auctionBids.listingId,row.id),eq(auctionBids.status,'leading')))]:[]),
    db.insert(auctionBids).values({id:bidId,listingId:row.id,bidderId:me.id,requestId:value.requestId,amount:applied.displayCents,status:leaderChanged?'leading':'outbid',sequence:row.auctionVersion+1,createdAt:stamp,rulesVersion:previewRulesVersion}),
    db.execute(sql`INSERT INTO ch_web.auction_bid_maxes(bid_id,listing_id,bidder_id,max_cents,created_at) VALUES(${bidId},${row.id},${me.id},${value.amount},${stamp})`),
    db.update(listings).set({currentBid:next.currentCents,leaderId:next.leader?.bidderId??null,leadingBidId:next.leader?.bidId??null,bidCount:sql`${listings.bidCount} + 1`,auctionVersion:sql`${listings.auctionVersion} + 1`}).where(eq(listings.id,row.id)),
    check.finish
   ] as never);
  }catch(error){if(operationGuardFailed(error))continue;throw error}
  const note=applied.outcome==='outbid'?'Another bidder’s maximum is higher. Your bid raised the price but you are not leading.':applied.outcome==='raised_max'?'Your maximum bid was raised. The price only increases when someone bids against you.':'You are the highest bidder. We bid for you, up to your maximum, only as needed.';
  return {saved:true,duplicate:false,listingId:row.id,outcome:applied.outcome,currentBid:next.currentCents,note};
 }
 throw new ApiRequestError('The auction is busy. Refresh and review the new price before bidding again.',409);
}

export type BidHistoryEntry={bidder:string;amountCents:number;placedAt:string;you:boolean};
/** Public bid history: masked handles and displayed prices only, never anyone's maximum. */
export async function bidHistory(db:Db,listingId:string,viewerId?:string):Promise<BidHistoryEntry[]>{
 const rows=await db.select({bidderId:auctionBids.bidderId,amount:auctionBids.amount,createdAt:auctionBids.createdAt,status:auctionBids.status,handle:profiles.handle}).from(auctionBids).leftJoin(profiles,eq(profiles.id,auctionBids.bidderId)).where(and(eq(auctionBids.listingId,listingId),inArray(auctionBids.status,['leading','outbid']))).orderBy(sql`${auctionBids.sequence} DESC`).limit(100);
 return rows.map(row=>({bidder:maskHandle(row.handle||'collector'),amountCents:Number(row.amount),placedAt:row.createdAt,you:!!viewerId&&row.bidderId===viewerId}));
}

/** Lazily resolves ended binding auctions (bounded per call). Winners get a 48-hour payment window. */
export async function resolveEndedAuctions(db:Db,limit=25,stamp=new Date().toISOString()){
 const due=await tolerant(async()=>{await ensureLocalAuctionSchema(db);return db.execute(sql`SELECT l.id FROM listings l JOIN ch_web.marketplace_auction_terms t ON t.listing_id = l.id WHERE l.sale_type = 'auction' AND l.status = 'active' AND l.end_at <= ${stamp} AND t.result = '' ORDER BY l.end_at LIMIT ${limit}`)},{rows:[]} as unknown as Awaited<ReturnType<Db['execute']>>);
 const resolved:{listingId:string;result:string}[]=[];
 for(const {id} of due.rows as {id:string}[]){
  const [row]=await db.select().from(listings).where(eq(listings.id,id)),terms=(await auctionTerms(db,[id])).get(id);if(!row||!terms)continue;
  const outcome=resolveAuction(await proxyState(db,row,terms)),won=outcome.result==='awaiting_payment';
  const due48=new Date(Date.parse(stamp)+AUCTION_PAYMENT_WINDOW_HOURS*3600000).toISOString();
  const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN ch_web.marketplace_auction_terms t ON t.listing_id = l.id WHERE l.id = ${id} AND l.status = 'active' AND l.auction_version = ${row.auctionVersion} AND t.result = '')`);
  try{await db.batch([
   check.start,
   db.update(listings).set({status:won?'auction_won':'ended'}).where(eq(listings.id,id)),
   db.execute(sql`UPDATE ch_web.marketplace_auction_terms SET result=${outcome.result},winner_id=${outcome.winnerId},winning_cents=${outcome.winningCents},resolved_at=${stamp},payment_due_at=${won?due48:null} WHERE listing_id=${id}`),
   ...(won?[]:[db.delete(listingInventory).where(eq(listingInventory.listingId,id))]),
   db.update(offers).set({status:'closed'}).where(and(eq(offers.listingId,id),eq(offers.status,'pending'))),
   check.finish
  ] as never)}catch(error){if(operationGuardFailed(error))continue;throw error}
  resolved.push({listingId:id,result:outcome.result});
 }
 return resolved;
}

/** Seller action after the 48-hour window: record non-payment and release the copies to relist. */
export async function markAuctionUnpaid(db:Db,me:Profile,listingId:string,stamp=new Date().toISOString()){
 const [row]=await db.select().from(listings).where(and(eq(listings.id,listingId),eq(listings.sellerId,me.id)));
 const terms=(await auctionTerms(db,[listingId])).get(listingId);
 if(!row||!terms)throw new ApiRequestError('Auction not found.',404);
 if(terms.result==='unpaid')return {saved:true,duplicate:true,note:'This auction is already marked unpaid.'};
 if(row.status!=='auction_won'||terms.result!=='awaiting_payment')throw new ApiRequestError('Only a won auction awaiting payment can be marked unpaid.',409);
 if(!terms.paymentDueAt||Date.parse(terms.paymentDueAt)>Date.parse(stamp))throw new ApiRequestError('The winner has until '+new Date(terms.paymentDueAt||stamp).toLocaleString('en-US',{timeZone:'America/Chicago'})+' Central to pay.',409);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM listings l WHERE l.id = ${row.id} AND l.status = 'auction_won') AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = ${row.id} AND o.status NOT IN ('cancelled','refunded','checkout_expired'))`);
 try{await db.batch([check.start,db.update(listings).set({status:'ended'}).where(eq(listings.id,row.id)),db.execute(sql`UPDATE ch_web.marketplace_auction_terms SET result='unpaid' WHERE listing_id=${row.id}`),db.delete(listingInventory).where(eq(listingInventory.listingId,row.id)),check.finish] as never)}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('The winner started checkout. Check Orders before changing this auction.',409);throw error}
 return {saved:true,note:'Marked unpaid. Your copies are released, so you can relist them.'};
}
/** Checkout eligibility for a won auction: the winner only, inside the payment window. */
export function wonAuctionPayable(row:ListingRow,terms:AuctionTerms|undefined,buyerProfileId:string,stamp=Date.now()){
 return !!terms&&row.saleType==='auction'&&row.status==='auction_won'&&terms.result==='awaiting_payment'&&terms.winnerId===buyerProfileId&&row.leaderId===buyerProfileId&&terms.winningCents!==null&&terms.winningCents===row.currentBid&&!!terms.paymentDueAt&&Date.parse(terms.paymentDueAt)>stamp;
}
/** Statement for the payment batch; callers run ensureLocalAuctionSchema first. */
export function markAuctionPaidStatement(db:Db,listingId:string){return db.execute(sql`UPDATE ch_web.marketplace_auction_terms SET result='paid' WHERE listing_id=${listingId} AND result='awaiting_payment'`)}
export {reserveMet};
