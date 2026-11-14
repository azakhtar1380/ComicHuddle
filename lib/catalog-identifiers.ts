import {getPool} from '../db/postgres';
import {identifiersFromRecord,parseComicIdentifier} from './comic-identifiers';
import {catalogIssuesById} from './catalog-store';
import {getDb} from '../db';
import {lookupMetronIdentifier,type MetronDeps,type MetronLookup} from './metron-identifiers';
export async function syncIdentifierBatch(limit=10000){
 const pool=getPool(),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('comichuddle-identifiers'))");
  await client.query("INSERT INTO ch_web.directory_identifier_sync(id) VALUES('native-gcd') ON CONFLICT DO NOTHING");
  const state=(await client.query("SELECT * FROM ch_web.directory_identifier_sync WHERE id='native-gcd' FOR UPDATE")).rows[0];
  const rows=(await client.query(`SELECT id,to_jsonb(i)->>'barcode' AS barcode,to_jsonb(i)->>'isbn' AS isbn,to_jsonb(i)->>'valid_isbn' AS valid_isbn FROM gcd.gcd_issue i WHERE id>$1 AND COALESCE(to_jsonb(i)->>'deleted','0') NOT IN ('1','true') AND (COALESCE(to_jsonb(i)->>'barcode','')<>'' OR COALESCE(to_jsonb(i)->>'isbn','')<>'' OR COALESCE(to_jsonb(i)->>'valid_isbn','')<>'') ORDER BY id LIMIT $2`,[state.last_issue_id,Math.min(20000,Math.max(1,limit))])).rows;
  let entries=0,matched=0;
  for(let offset=0;offset<rows.length;offset+=500){const group=rows.slice(offset,offset+500).flatMap(row=>{const codes=identifiersFromRecord(row);if(codes.length)matched++;return codes.map(code=>({issue_id:4000000000+Number(row.id),...code}))});entries+=group.length;if(group.length)await client.query(`INSERT INTO ch_web.directory_identifiers(issue_id,source,identifier,lookup_key,supplement,kind) SELECT issue_id,'GCD',identifier,"lookupKey",supplement,kind FROM jsonb_to_recordset($1::jsonb) AS r(issue_id bigint,identifier text,"lookupKey" text,supplement text,kind text) ON CONFLICT(issue_id,source,identifier) DO NOTHING`,[JSON.stringify(group)])}
  await client.query("UPDATE ch_web.directory_identifier_sync SET last_issue_id=$1,scanned_count=scanned_count+$2,matched_issue_count=matched_issue_count+$3,identifier_count=identifier_count+$4,completed_at=CASE WHEN $2=0 THEN now() ELSE NULL END,updated_at=now() WHERE id='native-gcd'",[rows.at(-1)?.id??state.last_issue_id,rows.length,matched,entries]);await client.query('COMMIT');return {complete:rows.length===0,scanned:rows.length,identifiers:entries};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export type IdentifierMatch='exact'|'base'|'metron'|'none';
/**
 * Local index first (exact supplement, then records stored without a
 * supplement), then the optional server-side Metron fallback. A supplement
 * mismatch never hides a base-only catalog record.
 */
export async function lookupComicIdentifier(value:string,supplement='',format='',deps:MetronDeps={}){
 const code=parseComicIdentifier(value,supplement,format);if(!code)return null;
 const pool=getPool(),query=(onlyBase:boolean)=>pool.query(`SELECT DISTINCT issue_id FROM ch_web.directory_identifiers WHERE lookup_key=$1 AND ${onlyBase?"supplement=''":"($2='' OR supplement=$2)"} ORDER BY issue_id LIMIT 13`,onlyBase?[code.lookupKey]:[code.lookupKey,code.supplement]);
 let result=await query(false),match:IdentifierMatch=result.rows.length?'exact':'none';
 if(!result.rows.length&&code.supplement){result=await query(true);if(result.rows.length)match='base'}
 const state=await pool.query("SELECT scanned_count,matched_issue_count,identifier_count,completed_at,updated_at FROM ch_web.directory_identifier_sync WHERE id='native-gcd'");
 const db=getDb();let issues=await catalogIssuesById(db,result.rows.slice(0,12).map(row=>Number(row.issue_id))),hasMore=result.rows.length>12;
 let metron:MetronLookup={status:'disabled',cached:false,issues:[],external:[],total:0};
 if(!issues.length){
  metron=await lookupMetronIdentifier(db,code,deps);
  if(metron.issues.length){issues=metron.issues.slice(0,12);match='metron';hasMore=metron.total>metron.issues.length+metron.external.length}
 }
 const notice=match==='base'?'No record carries this exact supplement; these share the base barcode. Check the issue number, year, printing and variant.'
  :match==='metron'?'Matched through Metron barcode data. Confirm the year, printing and variant.'
  :code.supplement?'The supplement was included. Confirm the year, printing and variant.':'A base barcode can identify several editions. Confirm the year, printing and variant; enter the supplement if visible.';
 return {identifier:code,issues,hasMore,match,index:state.rows[0]||null,notice,external:metron.external,metron:{status:metron.status,cached:metron.cached}};
}
