// Verified checkmark for people and businesses: the label matches the kind; collectors move from pending to
// verified only when an admin turns it on, and then show up as verified everywhere businesses already do.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {VerifiedBadge,verifiedLabel} from '../components/verified-badge';
import {requestPersonVerification,setPersonVerified,personVerification,verifiedKinds} from '../lib/person-verification';
import {businessSummaries,sellerBusinessFields} from '../lib/business-profile';

test('verified badge: accessible name and label text match the kind; businesses get the Shop tag',()=>{
 const person=renderToStaticMarkup(createElement(VerifiedBadge,{kind:'person'}));
 assert.match(person,/aria-label="Verified collector"/);assert.doesNotMatch(person,/Shop/);
 const business=renderToStaticMarkup(createElement(VerifiedBadge,{kind:'business',label:true}));
 assert.match(business,/>Verified business</);assert.match(business,/Shop/);
 assert.match(renderToStaticMarkup(createElement(VerifiedBadge,{kind:'person',label:true})),/>Verified collector</);
 assert.match(renderToStaticMarkup(createElement(VerifiedBadge,{})),/Verified business/,'the old default still means a business');
 assert.equal(verifiedLabel('person'),'Verified collector');assert.equal(verifiedLabel('business'),'Verified business');
 assert.match(person,/#1d5fc4/,'the same blue');
});

let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await engine.exec('CREATE SCHEMA ch_web;CREATE SCHEMA gcd');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort()){try{await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'))}catch{/* catalog migrations need GCD tables; not needed here */}}
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await engine.exec(`INSERT INTO ch_web.profiles(id,user_id,handle,name,bio,tagline,location,favorite,since,color,featured,visible,dm_open,created_at) VALUES('p1','u1','ava','Ava','','','Minneapolis, MN','',2015,'red','[]',1,1,'2026-11-01T00:00:00.000Z')`);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

test('a collector goes from pending to verified only after admin approval',async()=>{
 assert.equal((await personVerification('p1')).status,'unverified');
 assert.equal((await requestPersonVerification({id:'p1',userId:'u1'},'email is fine')).status,'pending');
 assert.equal((await businessSummaries(['p1'])).get('p1')?.verified,false,'pending shows no check');
 const granted=await setPersonVerified('admin','p1',true,'Video call on Nov 16');
 assert.deepEqual([granted.status,granted.changed,granted.userId],['verified',true,'u1']);
 const summary=(await businessSummaries(['p1'])).get('p1')!;
 assert.deepEqual([summary.isBusiness,summary.verified],[false,true]);
 assert.deepEqual(sellerBusinessFields(summary),{isBusiness:false,verified:true,shopName:null},'listings and messages show it too');
 assert.equal((await verifiedKinds(['p1'])).get('p1'),'person');
 const events=(await engine.query<{action:string;source:string}>("SELECT action,source FROM ch_web.business_verification_events WHERE profile_id='p1' ORDER BY created_at")).rows;
 assert.deepEqual(events.map(e=>e.action),['person_requested','person_granted']);
 const removed=await setPersonVerified('admin','p1',false,'Account sold');assert.equal(removed.status,'revoked');
 assert.equal((await businessSummaries(['p1'])).get('p1')?.verified,false);
});
