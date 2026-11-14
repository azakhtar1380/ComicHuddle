import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {nativeGcdFixture} from './native-gcd-fixture';

test('additive migration runner applies 024+ once and verifies checksums on rerun',async()=>{
 const engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web;');
 const all=readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')).sort();
 for(const name of all.filter(n=>Number(n.slice(0,3))<24&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)))await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('CREATE TABLE IF NOT EXISTS ch_web.schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz DEFAULT now())');
 const query=async(config:string|{text:string},values:unknown[]=[])=>{const text=typeof config==='string'?config:config.text;const r=values.length?await engine.query<Record<string,unknown>>(text,values):await engine.exec(text).then(results=>results.at(-1)??{rows:[],fields:[],affectedRows:0});return {...r,rowCount:(r as {affectedRows?:number}).affectedRows??0}};
 const pool={query,connect:async()=>({query,release(){}}),end:async()=>{}};
 const g=globalThis as typeof globalThis&{comicHuddlePool?:unknown};
 const expected=all.filter(n=>Number(n.slice(0,3))>=24);
 try{
  g.comicHuddlePool=pool;await import('../scripts/migrate-additive.ts?first');
  const first=(await engine.query<{name:string}>('SELECT name FROM ch_web.schema_migrations ORDER BY name')).rows.map(r=>r.name);
  assert.deepEqual(first,expected,'every 024+ migration recorded once');
  g.comicHuddlePool=pool;await import('../scripts/migrate-additive.ts?second');
  const second=(await engine.query<{count:number}>('SELECT count(*)::int AS count FROM ch_web.schema_migrations')).rows[0].count;
  assert.equal(second,expected.length,'rerun applies nothing new');
  if(expected.length){await engine.query('UPDATE ch_web.schema_migrations SET sha256=$1 WHERE name=$2',['tampered',expected[0]]);g.comicHuddlePool=pool;await assert.rejects(import('../scripts/migrate-additive.ts?third'),/changed/)}
 }finally{delete g.comicHuddlePool;await engine.close()}
});
