import {getPool} from '../db/postgres';
import {identifiersFromRecord,parseComicIdentifier} from './comic-identifiers';
import {catalogIssuesById} from './catalog-store';
import {getDb} from '../db';
export async function syncIdentifierBatch(limit=10000){
 const pool=getPool(),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('comichuddle-identifiers'))");
  await client.query("INSERT INTO ch_web.directory_identifier_sync(id) VALUES('native-gcd') ON CONFLICT DO NOTHING");
  const state=(await client.query("SELECT * FROM ch_web.directory_identifier_sync WHERE id='native-gcd' FOR UPDATE")).rows[0];
  const rows=(await client.query(`SELECT id,to_jsonb(i)->>'barcode' AS barcode,to_jsonb(i)->>'isbn' AS isbn,to_jsonb(i)->>'valid_isbn' AS valid_isbn FROM gcd.gcd_issue i WHERE id>$1 AND COALESCE(to_jsonb(i)->>'deleted','0') NOT IN ('1','true') ORDER BY id LIMIT $2`,[state.last_issue_id,Math.min(20000,Math.max(1,limit))])).rows;
  let entries=0,matched=0;
  for(let offset=0;offset<rows.length;offset+=500){const group=rows.slice(offset,offset+500).flatMap(row=>{const codes=identifiersFromRecord(row);if(codes.length)matched++;return codes.map(code=>({issue_id:4000000000+Number(row.id),...code}))});entries+=group.length;if(group.length)await client.query(`INSERT INTO ch_web.directory_identifiers(issue_id,source,identifier,lookup_key,supplement,kind) SELECT issue_id,'GCD',identifier,"lookupKey",supplement,kind FROM jsonb_to_recordset($1::jsonb) AS r(issue_id bigint,identifier text,"lookupKey" text,supplement text,kind text) ON CONFLICT(issue_id,source,identifier) DO NOTHING`,[JSON.stringify(group)])}
  await client.query("UPDATE ch_web.directory_identifier_sync SET last_issue_id=$1,scanned_count=scanned_count+$2,matched_issue_count=matched_issue_count+$3,identifier_count=identifier_count+$4,completed_at=CASE WHEN $2=0 THEN now() ELSE NULL END,updated_at=now() WHERE id='native-gcd'",[rows.at(-1)?.id??state.last_issue_id,rows.length,matched,entries]);await client.query('COMMIT');return {complete:rows.length===0,scanned:rows.length,identifiers:entries};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function lookupComicIdentifier(value:string,supplement=''){
 const code=parseComicIdentifier(value,supplement);if(!code)return null;
 const pool=getPool(),result=await pool.query(`SELECT DISTINCT issue_id FROM ch_web.directory_identifiers WHERE lookup_key=$1 AND ($2='' OR supplement=$2) ORDER BY issue_id LIMIT 13`,[code.lookupKey,code.supplement]);
 const state=await pool.query("SELECT scanned_count,matched_issue_count,identifier_count,completed_at,updated_at FROM ch_web.directory_identifier_sync WHERE id='native-gcd'");
 const issues=await catalogIssuesById(getDb(),result.rows.slice(0,12).map(row=>Number(row.issue_id)));
 return {identifier:code,issues,hasMore:result.rows.length>12,index:state.rows[0]||null,notice:code.supplement?'The supplement was included. Confirm the year, printing and variant.':'A base barcode can identify several editions. Confirm the year, printing and variant; enter the supplement if visible.'};
}
