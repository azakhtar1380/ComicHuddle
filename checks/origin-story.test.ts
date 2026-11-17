// Origin story nudge (migration 056): five panels, one 'system' notification, snooze until the next haul.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {originStory,nudgeOriginStory,snoozeOriginStory,originStoryAfterHaul} from '../lib/origin-story';

let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await engine.exec('CREATE SCHEMA ch_web;CREATE SCHEMA gcd');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort()){try{await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'))}catch{/* catalog migrations need GCD tables */}}
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await engine.exec(`INSERT INTO ch_web.profiles(id,user_id,handle,name,bio,tagline,location,favorite,since,color,featured,visible,dm_open,created_at) VALUES('p1','u1','ava','Ava','','','Minneapolis, MN','',2015,'red','[]',1,1,'2026-11-01T00:00:00.000Z')`);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});
const nudges=async()=>(await engine.query<{kind:string;href:string}>("SELECT kind,href FROM ch_web.notifications WHERE user_id='u1' AND title='Your origin story is still blank!'")).rows;

test('five panels; the nudge is sent once; snooze until the next haul',async()=>{
 const s=await originStory('u1');
 assert.deepEqual(s.steps.map(x=>[x.label,x.done]),[['Profile photo',false],['Cover photo',false],['Favorite character',false],['Favorite comic',false],['Grail',false]]);
 assert.equal(await nudgeOriginStory('u1'),true);assert.equal(await nudgeOriginStory('u1'),false,'only once');
 assert.deepEqual(await nudges(),[{kind:'system',href:'/origin-story'}]);
 await snoozeOriginStory('u1');assert.equal((await originStory('u1')).snoozed,true);
 await originStoryAfterHaul('u1',0);assert.equal((await nudges()).length,1,'no comics added: still snoozed');
 await originStoryAfterHaul('u1',3);
 assert.equal((await originStory('u1')).snoozed,false,'the next haul ends the snooze');
 assert.equal((await nudges()).length,2,'and reminds them once more');
});
