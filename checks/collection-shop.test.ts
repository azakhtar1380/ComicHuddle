// My Collection as a comic shop (migration 052): runs computed from the vault, the per-copy ledger,
// and the public Collection tab following the Shop window without ever exposing value or private details.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {createRun,listRuns,missingIssueIds,deleteRun,runInput} from '../lib/collection-runs';
import {syncVaultLedger,addedDates,normalizeCert} from '../lib/vault-ledger';
import {publicCollection} from '../lib/collection-shop';
import {emptyVault,type Vault} from '../lib/vault';

let engine:PGlite;const pool=new Pool(),db=getDb();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await engine.exec(`ALTER TABLE gcd.gcd_series ADD COLUMN IF NOT EXISTS year_began integer;
  INSERT INTO gcd.gcd_publisher VALUES(78,'Marvel',0);
  INSERT INTO gcd.gcd_series(id,name,publisher_id,deleted,year_began) VALUES(900,'The Uncanny X-Men',78,0,1963);
  INSERT INTO gcd.gcd_issue(id,series_id,number,key_date,variant_name,variant_of_id,deleted) VALUES
   (9001,900,'1','1981-01-00','',NULL,0),(9002,900,'2','1981-02-00','',NULL,0),(9003,900,'3','1981-03-00','',NULL,0),(9004,900,'4','1981-04-00','',NULL,0),(9005,900,'4','1981-04-00','Newsstand',9004,0)`);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

const gcdCopy=(id:string,gcd:number,extra:Partial<Vault['books'][number]>={})=>({id,title:'The Uncanny X-Men',issue:'#'+(gcd-9000),grade:'Raw · condition not recorded',price:0,externalCatalog:{provider:'GCD' as const,id:gcd,sourceUrl:'https://www.comics.org/issue/'+gcd+'/',license:'CC BY-SA 4.0' as const},...extra});

test('runs: owned and missing come from the vault; missing issues map to original printings',async()=>{
 const vault:Vault={...emptyVault('A'),books:[gcdCopy('a',9001),gcdCopy('b',9003)]};
 assert.equal(runInput.safeParse({issueId:4000009001,from:5,to:2}).success,false);
 assert.equal(runInput.safeParse({issueId:4000009001,from:1,to:1200}).success,false);
 const id=await createRun(db as never,'user-a',{issueId:4000009002,from:1,to:4});
 const [run]=await listRuns(db as never,'user-a',vault);
 assert.equal(run.seriesName,'The Uncanny X-Men');assert.equal(run.publisher,'Marvel');assert.equal(run.seriesYear,1963);
 assert.deepEqual([run.owned,run.missing,run.complete],[[1,3],[2,4],false]);
 assert.deepEqual((await missingIssueIds(db as never,'user-a',id,vault)).sort(),[4000009002,4000009004],'the newsstand variant is skipped');
 const full=await listRuns(db as never,'user-a',{...vault,books:[...vault.books,gcdCopy('c',9002),gcdCopy('d',9004)]});
 assert.equal(full[0].complete,true);
 assert.deepEqual(await listRuns(db as never,'someone-else',vault),[],'runs are private to their owner');
 await deleteRun(db as never,'user-b',id);assert.equal((await listRuns(db as never,'user-a',vault)).length,1,'only the owner can delete');
});

test('ledger: added dates, removals, re-adds and normalized certs',async()=>{
 const t0=new Date('2026-11-01T10:00:00Z'),t1=new Date('2026-11-02T10:00:00Z');
 const graded=gcdCopy('g',9001,{grade:'CGC 9.8',ownership:{format:'GRADED',rawCondition:null,gradingCompany:'CGC',grade:'9.8',labelType:'Universal',certificationNumber:'0001234567',purchasePriceCents:null,acquiredOn:null,notes:''}});
 await syncVaultLedger('user-l',{...emptyVault('L'),books:[graded]},t0);
 await syncVaultLedger('user-l',{...emptyVault('L'),books:[graded,gcdCopy('h',9002)]},t1);
 const rows=(await engine.query<{book_id:string;cert:string|null;added_at:Date;removed_at:Date|null}>("SELECT book_id,cert,added_at,removed_at FROM ch_web.vault_copies WHERE user_id='user-l' ORDER BY book_id")).rows;
 assert.equal(rows[0].cert,'1234567');assert.equal(new Date(rows[0].added_at).toISOString(),t0.toISOString(),'first add time kept');
 assert.equal(new Date(rows[1].added_at).toISOString(),t1.toISOString());
 await syncVaultLedger('user-l',{...emptyVault('L'),books:[gcdCopy('h',9002)]},new Date('2026-11-03T00:00:00Z'));
 assert.ok((await engine.query<{removed_at:Date|null}>("SELECT removed_at FROM ch_web.vault_copies WHERE user_id='user-l' AND book_id='g'")).rows[0].removed_at,'removal stamped');
 const dates=await addedDates('user-l',{...emptyVault('L'),books:[gcdCopy('h',9002)]});
 assert.deepEqual(Object.keys(dates),['h']);
 assert.equal(normalizeCert(' 000123-4567 '),'1234567');assert.equal(normalizeCert('12'),null);
});

test('public collection follows the shop window and never exposes value or private details',async()=>{
 const secret=gcdCopy('s',9001,{price:950,grade:'CGC 9.6',photoId:'11111111-1111-4111-8111-111111111111',ownership:{format:'GRADED',rawCondition:null,gradingCompany:'CGC',grade:'9.6',labelType:'Universal',certificationNumber:'7777777',purchasePriceCents:'95000',acquiredOn:'2024-01-02',notes:'Paid too much at the con'}});
 const vault:Vault={...emptyVault('P'),books:[secret,gcdCopy('r',9002)],tradeBookIds:['r']};
 const profile={id:'profile-p',userId:'user-p'};
 const shown=await publicCollection(db as never,profile,vault,'open');
 assert.equal(shown.comics.length,2);assert.equal(shown.glass.length,1,'graded copies go in the glass case');
 assert.equal(shown.comics.find(c=>c.id==='r')?.openToTrade,true);
 const text=JSON.stringify(shown);
 for(const leak of ['95000','950','7777777','Paid too much','2024-01-02','11111111-1111-4111-8111-111111111111','photoId','price','notes'])assert.ok(!text.includes(leak),'never exposes '+leak);
 const window=await publicCollection(db as never,profile,vault,'window');
 assert.equal(window.comics.length,0,'window display shows only the glass case, runs and favorites');assert.equal(window.glass.length,1);
 const closed=await publicCollection(db as never,profile,vault,'closed');
 assert.deepEqual([closed.window,closed.comics.length,closed.glass.length,closed.runs.length],['closed',0,0,0]);
});
