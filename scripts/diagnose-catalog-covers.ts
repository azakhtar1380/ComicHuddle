import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
try{
 await client.query("SET statement_timeout='15s'; SET lock_timeout='4s'");
 const tables=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='gcd' AND table_name IN('gcd_issue','gcd_series','gcd_publisher','gcd_cover')");
 const names=new Set(tables.rows.map(row=>row.table_name)),counts:Record<string,number|null>={};
 for(const table of ['gcd_series','gcd_publisher','gcd_cover']){
  counts[table]=null;if(names.has(table)){try{const result=await client.query('SELECT count(*)::bigint AS n FROM gcd.'+table);counts[table]=Number(result.rows[0].n)}catch(error){if((error as {code?:string}).code!=='57014')throw error}}
 }
 const view=await client.query("SELECT definition FROM pg_views WHERE schemaname='gcd' AND viewname='comichuddle_native_directory'");
 const definition=String(view.rows[0]?.definition||'').toLowerCase().replace(/[\"()]/g,'').replace(/\s+/g,' ');
 const references=await client.query("SELECT issue_id,gcd_id,status,image_url FROM ch_web.catalog_cover_references WHERE issue_id IN(4000017099,4000044451,4000076314) ORDER BY issue_id");
 let nativeCovers:unknown[]=[],nativeCoverRowsDeferred=false;
 const nativeCoverColumns=names.has('gcd_cover')?(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='gcd' AND table_name='gcd_cover' ORDER BY ordinal_position")).rows.map(row=>row.column_name):[];
 const nativeCoverIndexes=names.has('gcd_cover')?(await client.query("SELECT x.indisvalid AS valid,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid='gcd.gcd_cover'::regclass")).rows:[];
 if(nativeCoverColumns.includes('issue_id')&&nativeCoverColumns.includes('id')){
  try{nativeCovers=(await client.query('SELECT issue_id,id,to_jsonb(c)->>\'deleted\' AS deleted,to_jsonb(c)->>\'limit_display\' AS limit_display FROM gcd.gcd_cover c WHERE issue_id IN(17099,44451,76314) ORDER BY issue_id,id LIMIT 12')).rows}
  catch(error){if((error as {code?:string}).code!=='57014')throw error;nativeCoverRowsDeferred=true}
 }
 const saved=await client.query("SELECT metadata FROM gcd.comichuddle_catalog_read_state WHERE id='directory'").catch(()=>({rows:[]}));
 console.log('COVER_DIAGNOSTIC '+JSON.stringify({observedAt:new Date().toISOString(),nativeTables:[...names],companionExactCounts:counts,seriesIsOptional:/left join (?:gcd\.)?gcd_series\b/.test(definition),publisherIsOptional:/left join (?:gcd\.)?gcd_publisher\b/.test(definition),joinExpressions:definition.match(/(?:left|inner|right|full) join .{0,70}/g),exactIssueReferences:references.rows,nativeCoverColumns,nativeCoverIndexes,nativeCoverRows:nativeCovers,nativeCoverRowsDeferred,savedReadStateAvailable:saved.rows.length>0,nativeCoverJoin:'LEFT JOIN exact page identities to gcd_cover only when that table exists; no required-cover predicate'}));
}finally{client.release();await pool.end()}
