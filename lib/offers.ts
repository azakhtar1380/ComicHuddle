// Offers & trades (round 4). Server-only.
// ch_web.offers holds the amount currently on the table and whose turn it is:
//   pending   = the seller's turn (buyer's offer or buyer's counter)
//   countered = the buyer's turn (seller's counter)
//   accepted  = agreed price; the buyer pays through its own checkout (commerceOfferCheckout)
//   declined / withdrawn / closed (listing reserved or sold by someone else)
// Migration 039 (ch_web.offer_terms) adds the round history and deadlines. Every read is tolerant:
// without that table, expiry falls back to created_at + 48 hours and counter-offers stay off.
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {getDb} from '../db';
import {getPool} from '../db/postgres';
import {listings,offers,profiles} from '../db/schema';
import {ApiRequestError,isRestricted} from './api-security';
import {blocked} from './conversations';
import {avatarUrls} from './avatar';
import {notify} from './notifications';
import {evaluateCommercePolicy,type CommerceState} from './commerce-policy';

type Db=ReturnType<typeof getDb>;
type Profile=typeof profiles.$inferSelect;
export const OFFER_TTL_HOURS=48;
export const PICKUP_CODE_DAYS=7;
const hour=3600000,MAX_ROUNDS=10;
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const clip=(text:string,max=80)=>text.length>max?text.slice(0,max-1)+'…':text;

// ---------- offer_terms (migration 039) ----------
let termsCache:{at:number;ok:boolean}|null=null;
export async function offerTermsReady(){
 if(termsCache&&Date.now()-termsCache.at<60000)return termsCache.ok;
 let ok=false;try{const r=await getPool().query<{t:string|null}>("SELECT to_regclass('ch_web.offer_terms')::text AS t");ok=!!r.rows[0]?.t}catch{ok=false}
 termsCache={at:Date.now(),ok};return ok;
}
type Terms={offerId:string;originalCents:number;rounds:number;lastActor:'buyer'|'seller';expiresAt:string;acceptedAt:string|null};
async function termsFor(ids:string[]):Promise<Map<string,Terms>>{
 const out=new Map<string,Terms>();if(!ids.length||!await offerTermsReady())return out;
 try{
  const r=await getPool().query<{offer_id:string;original_cents:string;rounds:number;last_actor:'buyer'|'seller';expires_at:Date;accepted_at:Date|null}>('SELECT offer_id,original_cents,rounds,last_actor,expires_at,accepted_at FROM ch_web.offer_terms WHERE offer_id=ANY($1::text[])',[ids]);
  for(const row of r.rows)out.set(row.offer_id,{offerId:row.offer_id,originalCents:Number(row.original_cents),rounds:Number(row.rounds),lastActor:row.last_actor,expiresAt:new Date(row.expires_at).toISOString(),acceptedAt:row.accepted_at?new Date(row.accepted_at).toISOString():null});
 }catch{/* not migrated */}
 return out;
}
async function writeTerms(client:PoolClient,offerId:string,originalCents:number,rounds:number,lastActor:'buyer'|'seller',expiresAt:Date,acceptedAt:Date|null){
 await client.query(`INSERT INTO ch_web.offer_terms (offer_id,original_cents,rounds,last_actor,expires_at,accepted_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
  ON CONFLICT (offer_id) DO UPDATE SET rounds=EXCLUDED.rounds,last_actor=EXCLUDED.last_actor,expires_at=EXCLUDED.expires_at,accepted_at=EXCLUDED.accepted_at,updated_at=now()`,[offerId,originalCents,rounds,lastActor,expiresAt.toISOString(),acceptedAt?.toISOString()??null]);
}
/** Response deadline for an open offer, or the payment deadline for an accepted one (null = none recorded). */
export function offerDeadline(status:string,createdAt:string,terms?:Terms|null):string|null{
 if(status==='pending'||status==='countered'){if(terms&&!terms.acceptedAt)return terms.expiresAt;const created=Date.parse(createdAt);return Number.isFinite(created)?new Date(created+OFFER_TTL_HOURS*hour).toISOString():null}
 if(status==='accepted')return terms?.acceptedAt?terms.expiresAt:null;
 return null;
}
const past=(iso:string|null)=>!!iso&&Date.parse(iso)<=Date.now();

/** Server check used by the offer checkout: this buyer's accepted offer, inside its payment window. */
export async function acceptedOfferForCheckout(db:Db,offerId:string,buyerProfileId:string){
 const [offer]=await db.select().from(offers).where(eq(offers.id,offerId));
 if(!offer||offer.buyerId!==buyerProfileId)throw new ApiRequestError('Offer not found.',404);
 if(offer.status!=='accepted')throw new ApiRequestError('Only an accepted offer can go to checkout.',409);
 const terms=(await termsFor([offer.id])).get(offer.id),deadline=offerDeadline('accepted',offer.createdAt,terms);
 if(past(deadline))throw new ApiRequestError('The 48-hour payment window for this offer has ended. Make a new offer or buy at the listed price.',409);
 if(!Number.isSafeInteger(Number(offer.amount))||Number(offer.amount)<100)throw new ApiRequestError('This offer needs a valid price.',409);
 return {offerId:offer.id,listingId:offer.listingId,amountCents:Number(offer.amount)};
}
/** Used by the legacy seller reply (/api/social offer_response) to refuse expired offers. */
export async function offerExpired(offerId:string,status:string,createdAt:string){return past(offerDeadline(status,createdAt,(await termsFor([offerId])).get(offerId)))}

// ---------- list ----------
type Person={id:string;name:string;handle:string;color:string;avatarUrl:string|null};
type Item={title:string;issue:string;grade:string};
export type OfferView={kind:'offer'|'trade';id:string;tab:'received'|'sent';listing:{id:string;title:string;priceCents:number;shippingCents:number;photoId:string|null;available:boolean;fulfillment:string};other:Person;
 status:'pending'|'countered'|'accepted'|'declined'|'expired'|'withdrawn'|'closed'|'ordered'|'cancelled';yourTurn:boolean;deadline:string|null;createdAt:string;
 amountCents?:number;originalCents?:number|null;rounds?:number;note?:string;orderId?:string|null;orderStatus?:string|null;
 trade?:{threadId:string;version:number;offered:Item[];requested:Item[]};
 actions:{accept:boolean;counter:boolean;decline:boolean;withdraw:boolean;pay:boolean;cancel:boolean;message:boolean}};
function items(raw:string):Item[]{try{const value=JSON.parse(raw);return Array.isArray(value)?value.slice(0,10).map(v=>({title:String(v?.title||'Comic').slice(0,120),issue:String(v?.issue||'').slice(0,20),grade:String(v?.condition?.grade||v?.grade||'').slice(0,40)})):[]}catch{return []}}
function firstPhoto(raw:string|null){try{const value=JSON.parse(raw||'[]');return Array.isArray(value)&&typeof value[0]==='string'&&/^[a-f0-9-]{36}$/.test(value[0])?value[0]:null}catch{return null}}

export async function listOffersAndTrades(me:Profile){
 const pool=getPool();
 const offerRows=(await pool.query<{id:string;listing_id:string;buyer_id:string;amount:string;note:string;status:string;created_at:string;title:string;price:string;shipping:string;photos:string;listing_status:string;seller_id:string;fulfillment:string;sale_type:string}>(
  `SELECT o.id,o.listing_id,o.buyer_id,o.amount,o.note,o.status,o.created_at,l.title,l.price,l.shipping,l.photos,l.status AS listing_status,l.seller_id,l.fulfillment,l.sale_type
   FROM ch_web.offers o JOIN ch_web.listings l ON l.id=o.listing_id WHERE o.buyer_id=$1 OR l.seller_id=$1 ORDER BY o.created_at DESC LIMIT 200`,[me.id])).rows;
 const tradeRows=(await pool.query<{id:string;thread_id:string;listing_id:string;buyer_id:string;seller_id:string;status:string;version:string;buyer_items:string;seller_items:string;listing_snapshot:string;created_at:string;photos:string|null;price:string|null;shipping:string|null;listing_status:string|null;fulfillment:string|null}>(
  `SELECT t.id,t.thread_id,t.listing_id,t.buyer_id,t.seller_id,t.status,t.version,t.buyer_items,t.seller_items,t.listing_snapshot,t.created_at,l.photos,l.price,l.shipping,l.status AS listing_status,l.fulfillment
   FROM ch_web.trade_proposals t LEFT JOIN ch_web.listings l ON l.id=t.listing_id WHERE t.buyer_id=$1 OR t.seller_id=$1 ORDER BY t.created_at DESC LIMIT 100`,[me.id])).rows;
 const people=new Set<string>();for(const r of offerRows)people.add(r.buyer_id===me.id?r.seller_id:r.buyer_id);for(const r of tradeRows)people.add(r.buyer_id===me.id?r.seller_id:r.buyer_id);
 const ids=[...people];
 const [profileRows,avatars,terms]=await Promise.all([
  ids.length?pool.query<{id:string;name:string;handle:string;color:string;visible:number}>('SELECT id,name,handle,color,visible FROM ch_web.profiles WHERE id=ANY($1::text[])',[ids]).then(r=>r.rows):Promise.resolve([]),
  avatarUrls(ids),termsFor(offerRows.map(r=>r.id)),
 ]);
 const profileMap=new Map(profileRows.map(p=>[p.id,p]));
 const person=(id:string):Person=>{const p=profileMap.get(id);return p&&Number(p.visible)===1?{id,name:p.name,handle:p.handle,color:p.color,avatarUrl:avatars.get(id)||null}:{id,name:p?.name||'Former collector',handle:p?.handle||'',color:p?.color||'',avatarUrl:null}};
 // Orders started from an accepted offer carry {offer:{id}} in their snapshot.
 const accepted=offerRows.filter(r=>r.status==='accepted');const orders=new Map<string,{id:string;status:string}>();
 if(accepted.length){
  const rows=(await pool.query<{id:string;status:string;snapshot:string;created_at:string}>("SELECT id,status,snapshot,created_at FROM ch_web.commerce_orders WHERE listing_id=ANY($1::text[]) AND (buyer_id=$2 OR seller_id=$2) AND status NOT IN ('cancelled','checkout_expired') ORDER BY created_at DESC",[accepted.map(r=>r.listing_id),me.id])).rows;
  for(const row of rows){try{const offerId=JSON.parse(row.snapshot)?.offer?.id;if(typeof offerId==='string'&&!orders.has(offerId))orders.set(offerId,{id:row.id,status:row.status})}catch{}}
 }
 const counterOn=await offerTermsReady(),out:OfferView[]=[];
 for(const r of offerRows){
  const tab=r.buyer_id===me.id?'sent':'received',seller=tab==='received',t=terms.get(r.id)||null,deadline=offerDeadline(r.status,r.created_at,t),available=r.listing_status==='active'&&r.sale_type==='fixed',order=orders.get(r.id)||null,amount=Number(r.amount);
  let status:OfferView['status']=(['pending','countered','accepted','declined','withdrawn','closed'] as const).find(s=>s===r.status)||'closed';
  if((status==='pending'||status==='countered'||status==='accepted'&&!order)&&past(deadline))status='expired';
  if((status==='pending'||status==='countered')&&!available)status='closed';
  if(status==='accepted'&&order&&order.status!=='awaiting_payment')status='ordered';
  const myTurn=(status==='pending'&&seller)||(status==='countered'&&!seller),canCounter=myTurn&&counterOn&&(t?.rounds??0)<MAX_ROUNDS&&amount<Number(r.price);
  out.push({kind:'offer',id:r.id,tab,listing:{id:r.listing_id,title:r.title,priceCents:Number(r.price),shippingCents:Number(r.shipping),photoId:firstPhoto(r.photos),available,fulfillment:r.fulfillment},other:person(seller?r.buyer_id:r.seller_id),
   status,yourTurn:myTurn||status==='accepted'&&!seller&&available,deadline:status==='pending'||status==='countered'||status==='accepted'?deadline:null,createdAt:r.created_at,amountCents:amount,originalCents:t?.originalCents??null,rounds:t?.rounds??0,note:r.note,orderId:order?.id??null,orderStatus:order?.status??null,
   actions:{accept:myTurn&&available,counter:canCounter&&available,decline:myTurn,withdraw:status==='pending'&&!seller,pay:status==='accepted'&&!seller&&(available||order?.status==='awaiting_payment'),cancel:false,message:true}});
 }
 for(const r of tradeRows){
  const tab=r.buyer_id===me.id?'sent':'received',seller=tab==='received',created=Date.parse(r.created_at),deadline=r.status==='pending'&&Number.isFinite(created)?new Date(created+OFFER_TTL_HOURS*hour).toISOString():null;
  let title='Comic listing';try{title=String(JSON.parse(r.listing_snapshot)?.title||title)}catch{}
  let status:OfferView['status']=r.status==='accepted'?'accepted':r.status==='declined'?'declined':r.status==='cancelled'?'cancelled':'pending';
  if(status==='pending'&&past(deadline))status='expired';
  const available=r.listing_status==='active';if(status==='pending'&&!available)status='closed';
  const open=status==='pending';
  out.push({kind:'trade',id:r.id,tab,listing:{id:r.listing_id,title,priceCents:Number(r.price||0),shippingCents:Number(r.shipping||0),photoId:firstPhoto(r.photos),available,fulfillment:r.fulfillment||'shipping'},other:person(seller?r.buyer_id:r.seller_id),
   status,yourTurn:open&&seller,deadline,createdAt:r.created_at,trade:{threadId:r.thread_id,version:Number(r.version),offered:items(r.buyer_items),requested:items(r.seller_items)},
   actions:{accept:open&&seller,counter:open&&seller,decline:open&&seller,withdraw:false,pay:false,cancel:open&&!seller,message:true}});
 }
 out.sort((a,b)=>Number(b.yourTurn)-Number(a.yourTurn)||Date.parse(b.createdAt)-Date.parse(a.createdAt));
 return {received:out.filter(o=>o.tab==='received'),sent:out.filter(o=>o.tab==='sent'),ttlHours:OFFER_TTL_HOURS,counterOffers:counterOn};
}

// ---------- respond (accept / counter / decline / withdraw) ----------
const cents=z.number().int().min(100).max(100000000);
export const offerRespondSchema=z.object({action:z.literal('respond'),offerId:z.string().trim().min(1).max(100),decision:z.enum(['accept','decline','counter','withdraw']),expectedStatus:z.enum(['pending','countered']),expectedAmount:cents,amount:cents.optional()}).strict()
 .superRefine((v,ctx)=>{if(v.decision==='counter'&&v.amount===undefined)ctx.addIssue({code:z.ZodIssueCode.custom,path:['amount'],message:'Enter your counter-offer.'})});

export async function respondToOffer(db:Db,me:Profile,raw:Record<string,unknown>){
 const input=offerRespondSchema.parse(raw);
 const [offer]=await db.select().from(offers).where(eq(offers.id,input.offerId)),[listing]=offer?await db.select().from(listings).where(eq(listings.id,offer.listingId)):[];
 if(!offer||!listing)throw new ApiRequestError('Offer not found.',404);
 const role=offer.buyerId===me.id?'buyer':listing.sellerId===me.id?'seller':null;if(!role)throw new ApiRequestError('Offer not found.',404);
 const amount=Number(offer.amount);
 if(offer.status!==input.expectedStatus||amount!==input.expectedAmount)throw new ApiRequestError('This offer changed. Refresh to see the latest.',409);
 const allowed=input.decision==='withdraw'?role==='buyer'&&offer.status==='pending':(offer.status==='pending'&&role==='seller')||(offer.status==='countered'&&role==='buyer');
 if(!allowed)throw new ApiRequestError(input.decision==='withdraw'?'Only the buyer can withdraw an offer while the seller is deciding.':'It isn’t your turn to reply to this offer.',403);
 const terms=(await termsFor([offer.id])).get(offer.id)||null;
 if(past(offerDeadline(offer.status,offer.createdAt,terms)))throw new ApiRequestError('This offer expired after '+OFFER_TTL_HOURS+' hours without a reply.',409);
 const otherId=role==='buyer'?listing.sellerId:offer.buyerId,[other]=await db.select().from(profiles).where(eq(profiles.id,otherId));
 const moving=input.decision==='accept'||input.decision==='counter';
 if(moving){
  if(listing.status!=='active'||listing.saleType!=='fixed')throw new ApiRequestError('This listing is no longer available.',409);
  if(me.moderated||me.deletionStartedAt||await isRestricted(db,me.userId))throw new ApiRequestError('Your account can’t make marketplace agreements right now.',403);
  if(!other||other.moderated||other.deletionStartedAt||await isRestricted(db,other.userId)||await blocked(db,me.id,other.id))throw new ApiRequestError('This collector is no longer available.',403);
 }
 let next:string=offer.status,nextAmount=amount,rounds=terms?.rounds??0,lastActor:'buyer'|'seller'=terms?.lastActor??'buyer',acceptedAt:Date|null=null;
 const expires=new Date(Date.now()+OFFER_TTL_HOURS*hour);
 if(input.decision==='counter'){
  if(!await offerTermsReady())throw new ApiRequestError('Counter-offers turn on once the owner applies database update 039. You can accept or decline for now.',503);
  const value=input.amount!;
  if(rounds>=MAX_ROUNDS)throw new ApiRequestError('This offer has gone back and forth '+MAX_ROUNDS+' times. Accept, decline or message the other collector.',409);
  if(value>Number(listing.price))throw new ApiRequestError('A counter-offer can’t be above the listed price of '+usd(Number(listing.price))+'.',400);
  if(role==='seller'&&value<=amount)throw new ApiRequestError('Your counter must be higher than the buyer’s offer of '+usd(amount)+'. To take it, accept instead.',400);
  if(role==='buyer'&&value>=amount)throw new ApiRequestError('Your counter must be lower than the seller’s '+usd(amount)+'. To take it, accept instead.',400);
  next=role==='seller'?'countered':'pending';nextAmount=value;rounds+=1;lastActor=role;
 }else if(input.decision==='accept'){next='accepted';acceptedAt=new Date()}
 else next=input.decision==='withdraw'?'withdrawn':'declined';
 const client=await getPool().connect();
 try{
  await client.query('BEGIN');
  const listingGuard=moving?` AND EXISTS (SELECT 1 FROM ch_web.listings l WHERE l.id=o.listing_id AND l.status='active' AND l.sale_type='fixed' AND l.seller_id=$6 AND l.price=$7)`:'';
  const params:unknown[]=[next,nextAmount,offer.id,offer.status,amount];if(moving)params.push(listing.sellerId,listing.price);
  const updated=await client.query(`UPDATE ch_web.offers o SET status=$1,amount=$2 WHERE o.id=$3 AND o.status=$4 AND o.amount=$5${listingGuard} RETURNING o.id`,params);
  if(!updated.rowCount)throw new ApiRequestError('This offer or listing changed. Refresh before replying.',409);
  if(await offerTermsReady())await writeTerms(client,offer.id,terms?.originalCents??amount,rounds,lastActor,expires,acceptedAt);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
 await notifyOfferReply({offerId:offer.id,listingTitle:listing.title,status:next,amountCents:nextAmount,actor:me,toProfileId:otherId,toRole:role==='buyer'?'seller':'buyer'});
 const note=next==='accepted'?(role==='seller'?'Offer accepted. The buyer has 48 hours to pay '+usd(nextAmount)+'.':'Deal! Pay '+usd(nextAmount)+' within 48 hours to lock it in.'):next==='countered'||next==='pending'&&input.decision==='counter'?'Counter-offer of '+usd(nextAmount)+' sent. They have 48 hours to reply.':next==='withdrawn'?'Offer withdrawn.':'Offer declined.';
 return {saved:true,status:next,amountCents:nextAmount,note};
}

// ---------- trades (delegates to the existing agreement-only trade terms) ----------
export const tradeRespondSchema=z.object({action:z.literal('trade'),proposalId:z.string().uuid(),decision:z.enum(['accept','decline','cancel']),expectedVersion:z.number().int().min(0),agreementOnlyConsent:z.literal(true).optional()}).strict();
/** Refuses an expired pending trade; the caller then runs decideTradeTerms. */
export async function tradeOpenForDecision(proposalId:string){
 const r=await getPool().query<{created_at:string;status:string}>('SELECT created_at,status FROM ch_web.trade_proposals WHERE id=$1',[proposalId]);
 const row=r.rows[0];if(!row)throw new ApiRequestError('Trade proposal not found.',404);
 const created=Date.parse(row.created_at);if(row.status==='pending'&&Number.isFinite(created)&&Date.now()>=created+OFFER_TTL_HOURS*hour)throw new ApiRequestError('This trade proposal expired after '+OFFER_TTL_HOURS+' hours without a reply.',409);
}

// ---------- notifications ----------
async function userIdOf(profileId:string){try{const r=await getPool().query<{user_id:string;name:string}>('SELECT user_id,name FROM ch_web.profiles WHERE id=$1',[profileId]);return r.rows[0]||null}catch{return null}}
/** New offer from /api/social action 'offer': tells the seller. Never throws. */
export async function notifyNewOffer(input:{sellerProfileId:string;buyerName:string;listingTitle:string;amountCents:number}){
 try{const seller=await userIdOf(input.sellerProfileId);if(seller)await notify({userId:seller.user_id,kind:'offer',title:'New offer: '+usd(input.amountCents)+' for '+clip(input.listingTitle,60),body:input.buyerName+' made an offer. Reply within '+OFFER_TTL_HOURS+' hours or it expires.',href:'/offers?tab=received'})}catch{}
}
/** Any reply (accept, counter, decline, withdraw) tells the other side. Never throws. */
export async function notifyOfferReply(input:{offerId:string;listingTitle:string;status:string;amountCents:number;actor:{name:string};toProfileId:string;toRole:'buyer'|'seller'}){
 try{
  const to=await userIdOf(input.toProfileId);if(!to)return;const title=clip(input.listingTitle,60),price=usd(input.amountCents),href='/offers?tab='+(input.toRole==='buyer'?'sent':'received');
  const text=input.status==='accepted'?(input.toRole==='buyer'?{t:'Offer accepted: '+price+' for '+title,b:'Pay within 48 hours to lock it in. Checkout opens from Offers & trades.'}:{t:input.actor.name+' accepted '+price+' for '+title,b:'Waiting for the buyer to pay. You’ll get a notification when it’s paid.'})
   :input.status==='countered'||input.status==='pending'?{t:'Counter-offer: '+price+' for '+title,b:input.actor.name+' countered. Reply within 48 hours or it expires.'}
   :input.status==='withdrawn'?{t:'Offer withdrawn for '+title,b:input.actor.name+' withdrew their offer.'}
   :{t:'Offer declined for '+title,b:input.actor.name+' declined '+price+'.'};
  await notify({userId:to.user_id,kind:'offer_reply',title:text.t,body:text.b,href});
 }catch{}
}
/** Legacy seller reply through /api/social offer_response: records the payment window and notifies. */
export async function afterLegacyOfferResponse(offerId:string,status:'accepted'|'declined',seller:{name:string}){
 try{
  const r=await getPool().query<{buyer_id:string;amount:string;title:string}>('SELECT o.buyer_id,o.amount,l.title FROM ch_web.offers o JOIN ch_web.listings l ON l.id=o.listing_id WHERE o.id=$1',[offerId]);const row=r.rows[0];if(!row)return;
  if(status==='accepted'&&await offerTermsReady()){const terms=(await termsFor([offerId])).get(offerId);const client=await getPool().connect();try{await writeTerms(client,offerId,terms?.originalCents??Number(row.amount),terms?.rounds??0,terms?.lastActor??'buyer',new Date(Date.now()+OFFER_TTL_HOURS*hour),new Date())}finally{client.release()}}
  await notifyOfferReply({offerId,listingTitle:row.title,status,amountCents:Number(row.amount),actor:seller,toProfileId:row.buyer_id,toRole:'buyer'});
 }catch{}
}
export async function notifyTradeProposal(input:{sellerProfileId:string;buyerName:string;listingTitle:string}){
 try{const seller=await userIdOf(input.sellerProfileId);if(seller)await notify({userId:seller.user_id,kind:'trade',title:'Trade proposal for '+clip(input.listingTitle,60),body:input.buyerName+' offered comics in trade. Reply within '+OFFER_TTL_HOURS+' hours or it expires.',href:'/offers?tab=received'})}catch{}
}
export async function notifyTradeDecision(proposalId:string,status:string,actor:{id:string;name:string}){
 try{
  const r=await getPool().query<{buyer_id:string;seller_id:string;listing_snapshot:string}>('SELECT buyer_id,seller_id,listing_snapshot FROM ch_web.trade_proposals WHERE id=$1',[proposalId]);const row=r.rows[0];if(!row)return;
  const toBuyer=actor.id!==row.buyer_id,to=await userIdOf(toBuyer?row.buyer_id:row.seller_id);if(!to)return;
  let title='your listing';try{title=String(JSON.parse(row.listing_snapshot)?.title||title)}catch{}
  const word=status==='accepted'?'accepted':status==='declined'?'declined':'cancelled';
  await notify({userId:to.user_id,kind:'trade',title:'Trade '+word+': '+clip(title,60),body:actor.name+' '+word+' the trade proposal.'+(status==='accepted'?' Arrange the swap in Messages.':''),href:'/offers?tab='+(toBuyer?'sent':'received')});
 }catch{}
}

/** Order events for buyer and seller (paid, tracking added, pickup confirmed, pickup code expired). Never throws. */
export async function notifyOrderEvent(orderId:string,event:'paid'|'tracking'|'pickup'|'pickup_expired'){
 try{
  const r=await getPool().query<{buyer_user_id:string;seller_user_id:string;snapshot:string;state:string}>('SELECT buyer_user_id,seller_user_id,snapshot,state FROM ch_web.commerce_orders WHERE id=$1',[orderId]);const row=r.rows[0];if(!row)return;
  const snapshot=JSON.parse(row.snapshot) as {title?:string;fulfillment?:string;protection?:{tier?:string}},state=JSON.parse(row.state) as CommerceState&{trackingSubmission?:{carrier:string;number:string}};
  const title=clip(String(snapshot.title||'your comic'),60),pickup=snapshot.fulfillment==='pickup',sp=snapshot.protection?.tier==='safepurchase',buyerHref='/?section=Orders&role=buyer',sellerHref='/?section=Orders&role=seller';
  const day=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'';
  if(event==='paid'){
   let shipBy='';try{shipBy=day(evaluateCommercePolicy(state,new Date().toISOString()).trackingDeadlineAt)}catch{}
   await notify([
    {userId:row.buyer_user_id,kind:'order',title:'Payment confirmed: '+title,body:pickup?'Your pickup code is in Orders. Only share it once the comic is in your hands.':sp?'The seller ships it to ComicHuddle for inspection first.':'We’ll let you know when it ships.',href:buyerHref},
    {userId:row.seller_user_id,kind:'order',title:'Sold and paid: '+title,body:pickup?'Arrange the meetup in Messages. At the hand-off, enter or scan the buyer’s pickup code.':(sp?'Ship it to ComicHuddle for inspection':'Ship it to the buyer')+(shipBy?' and add tracking by '+shipBy+'.':' and add tracking.')+' The address is in Orders.',href:sellerHref},
   ]);
  }else if(event==='tracking'){
   const t=state.shipment?.trackingNumber?{carrier:state.shipment.carrier,number:state.shipment.trackingNumber}:state.trackingSubmission?{carrier:state.trackingSubmission.carrier,number:state.trackingSubmission.number}:state.inspection?.inbound?{carrier:state.inspection.inbound.carrier,number:state.inspection.inbound.trackingNumber}:null;
   await notify({userId:row.buyer_user_id,kind:'tracking',title:(sp?'On its way to inspection: ':'Shipped: ')+title,body:t?t.carrier+' tracking '+t.number+'. Follow it in Orders.':'Follow it in Orders.',href:buyerHref});
  }else if(event==='pickup'){
   await notify([
    {userId:row.buyer_user_id,kind:'pickup',title:'Pickup confirmed: '+title,body:'Enjoy it! You can still report a problem from Orders during the review window.',href:buyerHref},
    {userId:row.seller_user_id,kind:'pickup',title:'Pickup confirmed: '+title,body:'The payment is released to you after the 72-hour review window.',href:sellerHref},
   ]);
  }else{
   await notify([
    {userId:row.buyer_user_id,kind:'pickup',title:'Pickup code expired: '+title,body:'The pickup didn’t happen within '+PICKUP_CODE_DAYS+' days, so your payment is being refunded.',href:buyerHref},
    {userId:row.seller_user_id,kind:'pickup',title:'Pickup expired: '+title,body:'The buyer’s code wasn’t used within '+PICKUP_CODE_DAYS+' days, so the buyer is being refunded.',href:sellerHref},
   ]);
  }
 }catch{}
}
