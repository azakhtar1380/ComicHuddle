// Trophies (migration 055): every threshold and every fair-play rule.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {nativeGcdFixture} from './native-gcd-fixture';
import {TROPHIES,tiersFor,nextTier,trophyById,TIER_NAMES} from '../lib/trophy-defs';
import {qualifyingOrder,dedupePairs,distinctReviews,ratingOk,awardTrophies,computeTrophyProgress,adminSetTrophy,nextUnseen,markSeen,MIN_ITEM_CENTS} from '../lib/trophies';
import {syncVaultLedger} from '../lib/vault-ledger';
import {emptyVault,type Vault} from '../lib/vault';

const H=3600000,D=24*H,NOW=Date.parse('2026-11-16T12:00:00.000Z');
const iso=(t:number)=>new Date(t).toISOString();
function order(id:string,{buyer='buyer',seller='seller',item=2500,status='transferred',delivered=NOW-5*D,pickup=null as null|{by:string;at:number},tier='standard',dispute='none',refund=false,created=NOW-10*D,listing='L-'+id}={}){
 return {id,buyer_user_id:buyer,seller_user_id:seller,buyer_id:'p-'+buyer,seller_id:'p-'+seller,listing_id:listing,status,created_at:iso(created),
  snapshot:JSON.stringify({itemAmountCents:item}),
  state:JSON.stringify({order:{paidAt:iso(created)},policy:{tier},shipment:{deliveredAt:pickup?null:delivered===null?null:iso(delivered)},pickup:pickup?{by:pickup.by,confirmedAt:iso(pickup.at)}:null,dispute,issue:null,financial:refund?{kind:'refund'}:null})};
}

test('every threshold: Bronze, Silver and Golden Age at the exact counts',()=>{
 const expected:Record<string,[number,number,number]|null>={origin_story:null,first_appearance:null,longbox_legend:[100,500,1000],key_master:[5,25,50],run_completist:[1,3,10],slab_squad:[1,10,25],grail_hunter:[1,5,20],first_sale:null,trusted_seller:[10,50,250],deal_maker:[5,25,100],local_hero:[3,15,50],safepurchase_pro:[1,5,20],five_star:[10,50,150],cover_contributor:[1,25,100],founding_huddler:null};
 assert.equal(TROPHIES.length,15);
 for(const def of TROPHIES){
  assert.deepEqual(def.thresholds,expected[def.id],def.id);
  if(!def.thresholds){assert.deepEqual(tiersFor(def,0),[]);assert.deepEqual(tiersFor(def,1),['single']);continue}
  const [b,s,g]=def.thresholds;
  assert.deepEqual(tiersFor(def,b-1),[],def.id+' below bronze');
  assert.deepEqual(tiersFor(def,b),['bronze']);assert.deepEqual(tiersFor(def,s-1),s-1>=b?['bronze']:[]);
  assert.deepEqual(tiersFor(def,s),['bronze','silver']);assert.deepEqual(tiersFor(def,g),['bronze','silver','golden']);
  assert.equal(nextTier(def,g),null,'maxed');
  assert.equal(nextTier(def,b)?.tier,'silver');
 }
 assert.deepEqual([TIER_NAMES.bronze,TIER_NAMES.silver,TIER_NAMES.golden],['Bronze Age','Silver Age','Golden Age']);
 assert.equal(trophyById('local_hero')!.nudge!(1),'1 more pickup for Local Hero');
 assert.equal(trophyById('longbox_legend')!.reason(1000),'1,000 comics in your collection.');
});

test('fair play: only completed orders past the review window, not refunded/cancelled/disputed, $5+',()=>{
 assert.ok(qualifyingOrder(order('ok'),NOW));
 assert.equal(qualifyingOrder(order('refunded',{status:'refunded'}),NOW),null,'refunded');
 assert.equal(qualifyingOrder(order('refund',{refund:true}),NOW),null,'refund operation');
 assert.equal(qualifyingOrder(order('cancel',{status:'cancelled'}),NOW),null,'cancelled');
 assert.equal(qualifyingOrder(order('dispute',{dispute:'open'}),NOW),null,'disputed');
 assert.equal(qualifyingOrder(order('small',{item:MIN_ITEM_CENTS-1}),NOW),null,'under $5');
 assert.ok(qualifyingOrder(order('five',{item:MIN_ITEM_CENTS}),NOW),'$5 exactly counts');
 assert.equal(qualifyingOrder(order('undelivered',{delivered:null as unknown as number}),NOW),null,'not delivered');
 assert.equal(qualifyingOrder(order('window',{delivered:NOW-71*H}),NOW),null,'Standard review window is 72h');
 assert.ok(qualifyingOrder(order('window2',{delivered:NOW-73*H}),NOW));
 assert.ok(qualifyingOrder(order('sp',{tier:'safepurchase',delivered:NOW-49*H}),NOW),'SafePurchase window is 48h');
 assert.equal(qualifyingOrder(order('sp2',{tier:'safepurchase',delivered:NOW-47*H}),NOW),null);
 assert.equal(qualifyingOrder(order('tap',{pickup:{by:'buyer',at:NOW-5*D}}),NOW),null,'a buyer tap is not a PIN pickup');
 assert.equal(qualifyingOrder(order('pin',{pickup:{by:'seller',at:NOW-5*D}}),NOW)?.pinPickup,true,'seller PIN pickup counts');
});

test('fair play: the same buyer–seller pair counts once per 7 days; one review per reviewer',()=>{
 const list=['a','b','c'].map((id,i)=>qualifyingOrder(order(id,{delivered:NOW-20*D+i*2*D}),NOW)!);
 assert.equal(dedupePairs(list).length,1,'three orders within 7 days count once');
 const spread=['a','b'].map((id,i)=>qualifyingOrder(order(id,{delivered:NOW-20*D+i*8*D}),NOW)!);
 assert.equal(dedupePairs(spread).length,2);
 const other=qualifyingOrder(order('x',{buyer:'other',delivered:NOW-19*D}),NOW)!;
 assert.equal(dedupePairs([...list,other]).length,2,'a different buyer is a different pair');
 const fb=(author:string,orderId:string,stars:number,at:number)=>({author_profile_id:author,order_id:orderId,rating:'positive',item_as_described:stars,communication:stars,shipping_speed:stars,created_at:iso(at)});
 const reviews=distinctReviews([fb('r1','o1',5,1),fb('r1','o2',4,2),fb('r2','o3',5,1),fb('r3','not-completed',5,1)],new Set(['o1','o2','o3']));
 assert.equal(reviews.length,2,'duplicate reviewer and reviews on incomplete orders don’t count');
 assert.equal(ratingOk([fb('a','o',5,1),fb('b','o',4,1)],4.8,98),false);assert.equal(ratingOk([fb('a','o',5,1)],4.8,98),true);
 assert.equal(ratingOk([{author_profile_id:'a',order_id:'o',rating:'negative',item_as_described:null,communication:null,shipping_speed:null,created_at:iso(1)}],4.5,95),false,'percent positive when no stars');
});

// ---------- database: quick deletes, duplicate certs, revocation, idempotent awards ----------
let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 for(const u of ['u1','u2'])await engine.query(`INSERT INTO ch_web.profiles(id,user_id,handle,name,bio,tagline,location,favorite,since,color,featured,visible,dm_open,created_at) VALUES($1,$2,$3,'Member','','','Minneapolis, MN','',2015,'red','[]',1,1,$4)`,['p-'+u,u,'member_'+u,iso(NOW-30*D)]);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});
const slab=(id:string,cert:string)=>({id,title:'Planet Comics',issue:'#12',grade:'CGC 9.0',price:0,catalogId:0,ownership:{format:'GRADED' as const,rawCondition:null,gradingCompany:'CGC' as const,grade:'9.0' as const,labelType:'Universal' as const,certificationNumber:cert,purchasePriceCents:null,acquiredOn:null,notes:''}});
async function saveVault(user:string,books:Vault['books'],at:number){
 const vault={...emptyVault('M'),books};
 await engine.query('INSERT INTO ch_web.collections(user_id,data,revision) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data',[user,JSON.stringify(vault),'r'+at]);
 await syncVaultLedger(user,vault,new Date(at));
}

test('quick deletes never count; a cert counts once, for its first owner',async()=>{
 await saveVault('u1',[slab('a','1111111')],NOW-10*D);
 await saveVault('u1',[],NOW-10*D+H);                     // deleted after an hour
 assert.equal((await computeTrophyProgress('u1',NOW)).first_appearance,0,'added and deleted within 24h');
 await saveVault('u2',[slab('b','0001111111')],NOW-9*D); // same cert, normalized
 await saveVault('u1',[slab('c','1111111')],NOW-8*D);
 const [one,two]=[await computeTrophyProgress('u1',NOW),await computeTrophyProgress('u2',NOW)];
 assert.equal(two.slab_squad,1,'u2 added the cert first (u1’s quick delete doesn’t count)');
 assert.equal(one.slab_squad,0,'a duplicate cert never counts twice');
 assert.equal(one.first_appearance,1);
});

test('awarding is idempotent, notifies once, revokes quietly, re-earns without a second unlock; admin revocation sticks',async()=>{
 const first=await awardTrophies('u2',NOW);
 assert.deepEqual(first.earned.map(e=>e.trophy+':'+e.tier).sort(),['first_appearance:single','slab_squad:bronze']);
 assert.deepEqual((await awardTrophies('u2',NOW)).earned,[],'second run awards nothing');
 const notes=(await engine.query<{kind:string;title:string;body:string;href:string}>("SELECT kind,title,body,href FROM ch_web.notifications WHERE user_id='u2' ORDER BY title")).rows;
 assert.deepEqual(notes.map(n=>[n.kind,n.title]),[['achievement','Trophy unlocked: First Appearance'],['achievement','Trophy unlocked: Slab Squad, Bronze Age']]);
 assert.equal(notes[1].body,'1 slab with cert numbers.');
 // The unlock screen shows once.
 const unseen=await nextUnseen('u2');assert.ok(unseen);await markSeen('u2',unseen!.trophy,unseen!.tier);
 const after=await nextUnseen('u2');assert.notEqual(after?.trophy+':'+after?.tier,unseen!.trophy+':'+unseen!.tier);
 // Count drops below the tier: quiet revoke, no notification.
 await saveVault('u2',[],NOW-H);
 const dropped=await awardTrophies('u2',NOW);
 assert.deepEqual(dropped.revoked.map(r=>r.trophy),['slab_squad']);
 assert.equal((await engine.query("SELECT 1 FROM ch_web.notifications WHERE user_id='u2'")).rows.length,2,'no notification for a revocation');
 // Earn it again: restored, no second unlock.
 await saveVault('u2',[slab('d','2222222')],NOW-H/2); // a new cert (the old one now belongs to u1, who added it before u2 re-added it)
 const again=await awardTrophies('u2',NOW);assert.deepEqual(again.earned,[]);
 assert.equal((await engine.query<{revoked_at:Date|null}>("SELECT revoked_at FROM ch_web.user_trophies WHERE user_id='u2' AND trophy='slab_squad' AND tier='bronze'")).rows[0].revoked_at,null);
 // Admin revocation sticks through awards until an admin restores it.
 await adminSetTrophy('admin','u2','slab_squad','bronze',true);await awardTrophies('u2',NOW);
 assert.ok((await engine.query<{revoked_at:Date|null}>("SELECT revoked_at FROM ch_web.user_trophies WHERE user_id='u2' AND trophy='slab_squad' AND tier='bronze'")).rows[0].revoked_at);
 await adminSetTrophy('admin','u2','slab_squad','bronze',false);
 assert.equal((await engine.query<{revoked_at:Date|null}>("SELECT revoked_at FROM ch_web.user_trophies WHERE user_id='u2' AND trophy='slab_squad' AND tier='bronze'")).rows[0].revoked_at,null);
});

test('founding huddler only before the configured date; never without one',async()=>{
 const saved=process.env.FOUNDING_HUDDLER_UNTIL;
 try{
  delete process.env.FOUNDING_HUDDLER_UNTIL;assert.equal((await computeTrophyProgress('u1',NOW)).founding_huddler,0);
  process.env.FOUNDING_HUDDLER_UNTIL=iso(NOW);assert.equal((await computeTrophyProgress('u1',NOW)).founding_huddler,1);
  process.env.FOUNDING_HUDDLER_UNTIL=iso(NOW-60*D);assert.equal((await computeTrophyProgress('u1',NOW)).founding_huddler,0);
 }finally{if(saved===undefined)delete process.env.FOUNDING_HUDDLER_UNTIL;else process.env.FOUNDING_HUDDLER_UNTIL=saved}
});
