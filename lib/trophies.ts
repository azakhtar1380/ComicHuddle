// Trophies (migration 055). Server-only. computeTrophyProgress counts everything from the database with the
// fair-play rules in lib/trophy-defs.ts; awardTrophies stores newly reached tiers (idempotent), quietly revokes
// tiers whose count dropped, and sends unlock / "almost there" notifications according to the member's switches.
import {getDb} from '../db';
import {getPool} from '../db/postgres';
import {notify} from './notifications';
import {issueKeys} from './issue-keys';
import {listRuns} from './collection-runs';
import {emptyVault,vaultSchema,type Vault} from './vault';
import {TIER_NAMES,TROPHIES,nextTier,tiersFor,trophyById,type TierKey,type TrophyStatus} from './trophy-defs';

const HOUR=3600000,DAY=24*HOUR;
export const MIN_ITEM_CENTS=500;
type OrderRow={id:string;buyer_user_id:string;seller_user_id:string;buyer_id:string;seller_id:string;listing_id:string;status:string;snapshot:string;state:string;created_at:string};
export type QualifyingOrder={id:string;buyerUserId:string;sellerUserId:string;buyerProfileId:string;sellerProfileId:string;listingId:string;completedAt:number;safePurchase:boolean;pinPickup:boolean;createdAt:number};
const BAD_STATUSES=new Set(['refunded','refund_pending','refund_eligible','cancelled','checkout_expired','manual_review','inspection_failed','awaiting_payment']);

/** Fair play: completed (delivered or PIN pickup), past the review window, not refunded/cancelled/disputed, item total $5+. */
export function qualifyingOrder(row:OrderRow,now=Date.now()):QualifyingOrder|null{
 let state:{policy?:{tier?:string};shipment?:{deliveredAt?:string|null};pickup?:{confirmedAt:string;by:string}|null;dispute?:string;issue?:{open?:boolean}|null;financial?:{kind?:string}|null;order?:{paidAt?:string|null}},snapshot:{itemAmountCents?:number};
 try{state=JSON.parse(row.state);snapshot=JSON.parse(row.snapshot)}catch{return null}
 if(BAD_STATUSES.has(row.status)||!state.order?.paidAt)return null;
 if((state.dispute&&state.dispute!=='none')||state.issue?.open||state.financial?.kind==='refund')return null;
 if(!Number.isFinite(snapshot.itemAmountCents)||(snapshot.itemAmountCents||0)<MIN_ITEM_CENTS)return null;
 const pinPickup=state.pickup?.by==='seller'&&!!state.pickup.confirmedAt;
 const doneAt=Date.parse(pinPickup?state.pickup!.confirmedAt:state.shipment?.deliveredAt||'');
 if(!Number.isFinite(doneAt))return null;
 const safePurchase=state.policy?.tier==='safepurchase',window=(safePurchase?48:72)*HOUR;
 if(now<doneAt+window)return null;
 return {id:row.id,buyerUserId:row.buyer_user_id,sellerUserId:row.seller_user_id,buyerProfileId:row.buyer_id,sellerProfileId:row.seller_id,listingId:row.listing_id,completedAt:doneAt,safePurchase,pinPickup,createdAt:Date.parse(row.created_at)};
}
/** The same buyer–seller pair counts at most once per 7 days. */
export function dedupePairs(orders:QualifyingOrder[]):QualifyingOrder[]{
 const last=new Map<string,number>(),out:QualifyingOrder[]=[];
 for(const order of [...orders].sort((a,b)=>a.completedAt-b.completedAt||a.id.localeCompare(b.id))){
  const pair=[order.buyerUserId,order.sellerUserId].sort().join('|'),previous=last.get(pair);
  if(previous!==undefined&&order.completedAt-previous<7*DAY)continue;
  last.set(pair,order.completedAt);out.push(order);
 }
 return out;
}
type Feedback={author_profile_id:string;order_id:string;rating:string;item_as_described:number|null;communication:number|null;shipping_speed:number|null;created_at:string};
/** Rating gate: average stars when any are given, else share positive. Empty history passes. */
export function ratingOk(rows:Feedback[],minStars:number,minPositive:number){
 const stars=rows.flatMap(r=>[r.item_as_described,r.communication,r.shipping_speed].filter((v):v is number=>typeof v==='number'));
 if(stars.length)return stars.reduce((a,b)=>a+b,0)/stars.length>=minStars;
 const positive=rows.filter(r=>r.rating==='positive').length,negative=rows.filter(r=>r.rating==='negative').length;
 return positive+negative===0||positive/(positive+negative)*100>=minPositive;
}
/** One review per reviewer (their latest), only reviews tied to completed orders. */
export function distinctReviews(rows:Feedback[],qualifyingIds:Set<string>){
 const latest=new Map<string,Feedback>();
 for(const row of rows){if(!qualifyingIds.has(row.order_id))continue;const seen=latest.get(row.author_profile_id);if(!seen||Date.parse(row.created_at)>Date.parse(seen.created_at))latest.set(row.author_profile_id,row)}
 return [...latest.values()];
}
const q=async<T>(text:string,values:unknown[]=[]):Promise<T[]>=>{try{return (await getPool().query(text,values)).rows as T[]}catch{return []}};
export const foundingCutoff=(env:Record<string,string|undefined>=process.env)=>{const v=env.FOUNDING_HUDDLER_UNTIL;const t=v?Date.parse(v):NaN;return Number.isFinite(t)?t:null};

/** Counts per trophy for one account, from the database. */
export async function computeTrophyProgress(userId:string,now=Date.now()):Promise<Record<string,number>>{
 const counts:Record<string,number>=Object.fromEntries(TROPHIES.map(t=>[t.id,0]));
 const [profile]=await q<{id:string;created_at:string}>('SELECT id,created_at FROM ch_web.profiles WHERE user_id=$1',[userId]);
 if(!profile)return counts;
 const [vaultRow]=await q<{data:string}>('SELECT data FROM ch_web.collections WHERE user_id=$1',[userId]);
 let vault:Vault=emptyVault('Collector');try{if(vaultRow)vault=vaultSchema.parse(JSON.parse(vaultRow.data))}catch{/* unreadable vault counts as empty */}
 // Collection: current Directory-linked copies; copies deleted within 24h of being added never count.
 const copies=await q<{book_id:string;directory_issue_id:string|null;graded:boolean;cert:string|null;added_at:string;removed_at:string|null}>('SELECT book_id,directory_issue_id,graded,cert,added_at,removed_at FROM ch_web.vault_copies WHERE user_id=$1',[userId]);
 const lasting=(c:{added_at:string;removed_at:string|null})=>!c.removed_at||Date.parse(c.removed_at)-Date.parse(c.added_at)>=DAY;
 const current=copies.filter(c=>!c.removed_at&&c.directory_issue_id!==null);
 counts.first_appearance=copies.some(c=>c.directory_issue_id!==null&&lasting(c))?1:0;
 counts.longbox_legend=current.length;
 const keys=await issueKeys(getDb() as never,current.map(c=>Number(c.directory_issue_id))).catch(()=>new Map());
 counts.key_master=current.filter(c=>keys.has(Number(c.directory_issue_id))).length;
 counts.run_completist=(await listRuns(getDb() as never,userId,vault).catch(()=>[])).filter(r=>r.total>=12&&r.complete).length;
 // A cert counts once on the whole site: only for the first owner who added it (quick deletes ignored).
 const certs=copies.filter(c=>!c.removed_at&&c.graded&&c.cert).map(c=>c.cert!);
 if(certs.length){
  const firsts=await q<{cert:string;user_id:string}>(`SELECT DISTINCT ON (cert) cert,user_id FROM ch_web.vault_copies WHERE cert = ANY($1::text[]) AND (removed_at IS NULL OR removed_at-added_at>=interval '24 hours') ORDER BY cert,added_at,user_id`,[certs]);
  const mine=new Set(firsts.filter(f=>f.user_id===userId).map(f=>f.cert));counts.slab_squad=new Set(certs.filter(c=>mine.has(c))).size;
 }
 // Orders, with the fair-play rules.
 const rows=await q<OrderRow>('SELECT id,buyer_user_id,seller_user_id,buyer_id,seller_id,listing_id,status,snapshot,state,created_at FROM ch_web.commerce_orders WHERE buyer_user_id=$1 OR seller_user_id=$1',[userId]);
 const orders=dedupePairs(rows.map(r=>qualifyingOrder(r,now)).filter((o):o is QualifyingOrder=>!!o));
 const sales=orders.filter(o=>o.sellerUserId===userId),buys=orders.filter(o=>o.buyerUserId===userId);
 counts.first_sale=sales.length?1:0;
 const feedback=await q<Feedback>(`SELECT author_profile_id,order_id,rating,item_as_described,communication,shipping_speed,created_at FROM ch_web.order_feedback WHERE subject_profile_id=$1 AND direction='buyer_to_seller'`,[profile.id]);
 const qualifyingIds=new Set(orders.map(o=>o.id)),reviews=distinctReviews(feedback,qualifyingIds);
 counts.trusted_seller=ratingOk(feedback.filter(f=>qualifyingIds.has(f.order_id)),4.5,95)?sales.length:0;
 counts.five_star=reviews.length&&ratingOk(reviews,4.8,98)?reviews.length:0;
 counts.local_hero=orders.filter(o=>o.pinPickup).length;
 counts.safepurchase_pro=orders.filter(o=>o.safePurchase).length;
 if(orders.length){
  const accepted=await q<{listing_id:string;buyer_id:string}>(`SELECT listing_id,buyer_id FROM ch_web.offers WHERE status='accepted' AND listing_id = ANY($1::text[])`,[orders.map(o=>o.listingId)]);
  counts.deal_maker=orders.filter(o=>accepted.some(a=>a.listing_id===o.listingId&&a.buyer_id===o.buyerProfileId)).length;
 }
 if(buys.length){
  const listings=await q<{id:string;issue_id:number|null}>('SELECT id,issue_id FROM ch_web.listings WHERE id = ANY($1::text[])',[buys.map(o=>o.listingId)]);
  const wants=await q<{issue_id:string;added_at:string;removed_at:string|null}>('SELECT issue_id,added_at,removed_at FROM ch_web.vault_wants WHERE user_id=$1',[userId]);
  counts.grail_hunter=buys.filter(o=>{const issue=listings.find(l=>l.id===o.listingId)?.issue_id;if(issue===null||issue===undefined)return false;const want=wants.find(w=>Number(w.issue_id)===Number(issue));return !!want&&Date.parse(want.added_at)<o.createdAt&&(!want.removed_at||Date.parse(want.removed_at)>=o.createdAt)}).length;
 }
 counts.cover_contributor=Number((await q<{n:string}>(`SELECT count(*)::text AS n FROM ch_web.community_covers WHERE user_id=$1 AND status='approved'`,[userId]))[0]?.n||0);
 const cutoff=foundingCutoff();counts.founding_huddler=cutoff!==null&&Date.parse(profile.created_at)<cutoff?1:0;
 const [origin]=await q<{photo:boolean;cover:boolean;character:boolean;grail:boolean;world:boolean}>(`SELECT EXISTS(SELECT 1 FROM ch_web.profile_avatars WHERE profile_id=$1) AS photo,
   COALESCE((SELECT cover_id IS NOT NULL FROM ch_web.profile_extras WHERE profile_id=$1),false) AS cover,
   COALESCE((SELECT favorite_character_id IS NOT NULL FROM ch_web.profile_extras WHERE profile_id=$1),false) AS character,
   COALESCE((SELECT grail_issue_id IS NOT NULL FROM ch_web.profile_extras WHERE profile_id=$1),false) AS grail,
   COALESCE((SELECT to_jsonb(x)->>'world' NOT IN ('classic','') FROM ch_web.profile_extras x WHERE profile_id=$1),false) AS world`,[profile.id]);
 counts.origin_story=origin&&origin.photo&&origin.cover&&origin.character&&origin.grail&&origin.world?1:0;
 return counts;
}

type Prefs={unlocks:boolean;almost:boolean;weekly:boolean};
export async function trophyPrefs(userId:string):Promise<Prefs>{const [row]=await q<Prefs>('SELECT unlocks,almost,weekly FROM ch_web.trophy_prefs WHERE user_id=$1',[userId]);return row?{unlocks:row.unlocks,almost:row.almost,weekly:row.weekly}:{unlocks:true,almost:true,weekly:false}}
export async function saveTrophyPrefs(userId:string,prefs:Prefs){await getPool().query('INSERT INTO ch_web.trophy_prefs(user_id,unlocks,almost,weekly,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(user_id) DO UPDATE SET unlocks=EXCLUDED.unlocks,almost=EXCLUDED.almost,weekly=EXCLUDED.weekly,updated_at=now()',[userId,prefs.unlocks,prefs.almost,prefs.weekly])}
type Stored={trophy:string;tier:TierKey;earned_at:string|null;seen_at:string|null;revoked_at:string|null;revoked_by:string|null;nudged_at:string|null};

/** Inserts newly reached tiers, quietly revokes dropped ones, notifies per the member's switches. Idempotent. */
export async function awardTrophies(userId:string,now=Date.now()):Promise<{earned:{trophy:string;tier:TierKey}[];revoked:{trophy:string;tier:TierKey}[]}>{
 const result={earned:[] as {trophy:string;tier:TierKey}[],revoked:[] as {trophy:string;tier:TierKey}[]};
 const counts=await computeTrophyProgress(userId,now);
 const stored=await q<Stored>('SELECT trophy,tier,earned_at,seen_at,revoked_at,revoked_by,nudged_at FROM ch_web.user_trophies WHERE user_id=$1',[userId]);
 const pool=getPool(),prefs=await trophyPrefs(userId),stamp=new Date(now).toISOString();
 for(const def of TROPHIES){
  const count=counts[def.id]||0,reached=new Set(tiersFor(def,count));
  for(const tier of reached){
   const row=stored.find(s=>s.trophy===def.id&&s.tier===tier);
   if(row?.earned_at&&!row.revoked_at)continue;
   if(row?.revoked_by)continue; // an admin revocation sticks until an admin restores it
   if(row?.earned_at&&row.revoked_at){await pool.query('UPDATE ch_web.user_trophies SET revoked_at=NULL WHERE user_id=$1 AND trophy=$2 AND tier=$3 AND revoked_by IS NULL',[userId,def.id,tier]);continue} // re-earned: no second unlock
   const inserted=await pool.query(`INSERT INTO ch_web.user_trophies(user_id,trophy,tier,earned_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,trophy,tier) DO UPDATE SET earned_at=EXCLUDED.earned_at WHERE ch_web.user_trophies.earned_at IS NULL RETURNING trophy`,[userId,def.id,tier,stamp]);
   if(!inserted.rowCount)continue;
   result.earned.push({trophy:def.id,tier});
   if(prefs.unlocks)await notify({userId,kind:'achievement',title:`Trophy unlocked: ${def.name}${tier==='single'?'':', '+TIER_NAMES[tier]}`,body:def.reason(count),href:'/trophies?unlocked='+encodeURIComponent(def.id+':'+tier)});
  }
  for(const row of stored.filter(s=>s.trophy===def.id&&s.earned_at&&!s.revoked_at&&!reached.has(s.tier))){
   await pool.query('UPDATE ch_web.user_trophies SET revoked_at=$4 WHERE user_id=$1 AND trophy=$2 AND tier=$3 AND revoked_at IS NULL',[userId,def.id,row.tier,stamp]);
   result.revoked.push({trophy:def.id,tier:row.tier}); // quiet: no notification
  }
  // "Almost there": once per tier at 80%.
  const next=nextTier(def,count);
  if(next&&def.nudge&&count>0&&count>=next.target*.8){
   const row=stored.find(s=>s.trophy===def.id&&s.tier===next.tier);
   if(!row?.nudged_at){
    const marked=await pool.query(`INSERT INTO ch_web.user_trophies(user_id,trophy,tier,nudged_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,trophy,tier) DO UPDATE SET nudged_at=EXCLUDED.nudged_at WHERE ch_web.user_trophies.nudged_at IS NULL RETURNING trophy`,[userId,def.id,next.tier,stamp]);
    if(marked.rowCount&&prefs.almost)await notify({userId,kind:'achievement',title:'Almost there: '+def.nudge(next.left),body:`progress:${count}/${next.target}`,href:'/trophies'});
   }
  }
 }
 return result;
}
/** Runs awardTrophies after the response when called inside a request, else right away. Never throws. */
export function queueTrophies(userIds:(string|null|undefined)[]){
 const ids=[...new Set(userIds.filter((id):id is string=>!!id))];if(!ids.length)return;
 const run=async()=>{for(const id of ids)await awardTrophies(id).catch(()=>undefined)};
 void import('next/server').then(({after})=>{try{after(run)}catch{void run()}}).catch(()=>void run());
}
export async function trophyStatus(userId:string):Promise<TrophyStatus[]>{
 const counts=await computeTrophyProgress(userId);
 const stored=await q<Stored>('SELECT trophy,tier,earned_at,seen_at,revoked_at,revoked_by,nudged_at FROM ch_web.user_trophies WHERE user_id=$1 AND earned_at IS NOT NULL AND revoked_at IS NULL',[userId]);
 return TROPHIES.map(def=>({id:def.id,name:def.name,group:def.group,rule:def.rule,count:counts[def.id]||0,thresholds:def.thresholds,earned:stored.filter(s=>s.trophy===def.id).map(s=>({tier:s.tier,earnedAt:new Date(s.earned_at!).toISOString()})),next:nextTier(def,counts[def.id]||0)}));
}
/** Highest earned tiers for a profile's trophy case preview (public). */
export async function trophyPreview(userId:string){
 const rows=await q<{trophy:string;tier:TierKey;earned_at:string}>('SELECT trophy,tier,earned_at FROM ch_web.user_trophies WHERE user_id=$1 AND earned_at IS NOT NULL AND revoked_at IS NULL',[userId]);
 const best=new Map<string,{trophy:string;tier:TierKey}>();
 const rank=(t:TierKey)=>t==='golden'?3:t==='silver'?2:t==='bronze'?1:0.5;
 for(const row of rows){const seen=best.get(row.trophy);if(!seen||rank(row.tier)>rank(seen.tier))best.set(row.trophy,{trophy:row.trophy,tier:row.tier})}
 const list=[...best.values()].sort((a,b)=>rank(b.tier)-rank(a.tier)).map(t=>({...t,name:trophyById(t.trophy)?.name||t.trophy}));
 return {top:list.slice(0,4),earned:best.size,total:TROPHIES.length};
}
export async function nextUnseen(userId:string){
 const [row]=await q<{trophy:string;tier:TierKey;earned_at:string}>('SELECT trophy,tier,earned_at FROM ch_web.user_trophies WHERE user_id=$1 AND earned_at IS NOT NULL AND seen_at IS NULL AND revoked_at IS NULL ORDER BY earned_at,trophy LIMIT 1',[userId]);
 if(!row)return null;
 const def=trophyById(row.trophy);if(!def)return null;
 const counts=await computeTrophyProgress(userId),count=counts[def.id]||0;
 const [stat]=await q<{holders:number;collectors:number}>('SELECT holders,collectors FROM ch_web.trophy_stats WHERE trophy=$1 AND tier=$2',[row.trophy,row.tier]);
 const closest=TROPHIES.map(t=>({t,n:nextTier(t,counts[t.id]||0)})).filter(x=>x.n).sort((a,b)=>b.n!.progress-a.n!.progress)[0];
 return {trophy:def.id,name:def.name,tier:row.tier,tierName:TIER_NAMES[row.tier],reason:def.reason(count),percent:stat&&stat.collectors>=50?Math.round(stat.holders/stat.collectors*100):null,
  next:closest?{name:closest.t.name,tierName:TIER_NAMES[closest.n!.tier],left:closest.n!.left,unit:closest.t.unit[closest.n!.left===1?0:1]}:null};
}
export async function markSeen(userId:string,trophy:string,tier:string){await q('UPDATE ch_web.user_trophies SET seen_at=now() WHERE user_id=$1 AND trophy=$2 AND tier=$3 AND seen_at IS NULL',[userId,trophy,tier])}
/** Daily: recompute everyone (catches revocations) and refresh the holder percentages. */
export async function dailyTrophySweep(limit=5000){
 const users=await q<{user_id:string}>(`SELECT p.user_id FROM ch_web.profiles p WHERE p.deletion_started_at IS NULL AND COALESCE(p.moderated,0)=0 ORDER BY p.created_at LIMIT $1`,[limit]);
 for(const u of users)await awardTrophies(u.user_id).catch(()=>undefined);
 await q(`INSERT INTO ch_web.trophy_stats(trophy,tier,holders,collectors,computed_at)
  SELECT t.trophy,t.tier,count(*)::int,(SELECT count(*)::int FROM ch_web.profiles WHERE deletion_started_at IS NULL),now() FROM ch_web.user_trophies t WHERE t.earned_at IS NOT NULL AND t.revoked_at IS NULL GROUP BY t.trophy,t.tier
  ON CONFLICT(trophy,tier) DO UPDATE SET holders=EXCLUDED.holders,collectors=EXCLUDED.collectors,computed_at=now()`);
 return users.length;
}
/** Admin: revoke or restore one tier. The caller writes the audit-log entry (migration 040). */
export async function adminSetTrophy(adminUserId:string,userId:string,trophy:string,tier:TierKey,revoke:boolean){
 if(!trophyById(trophy))throw Object.assign(new Error('Unknown trophy.'),{status:404});
 const r=revoke?await getPool().query(`UPDATE ch_web.user_trophies SET revoked_at=now(),revoked_by=$4 WHERE user_id=$1 AND trophy=$2 AND tier=$3 AND earned_at IS NOT NULL RETURNING trophy`,[userId,trophy,tier,'admin:'+adminUserId])
  :await getPool().query(`UPDATE ch_web.user_trophies SET revoked_at=NULL,revoked_by=NULL WHERE user_id=$1 AND trophy=$2 AND tier=$3 AND earned_at IS NOT NULL RETURNING trophy`,[userId,trophy,tier]);
 if(!r.rowCount)throw Object.assign(new Error('That member hasn’t earned that tier.'),{status:404});
 // The admin route records the action in the audit log (lib/admin-audit.ts logAdminAction).
}
