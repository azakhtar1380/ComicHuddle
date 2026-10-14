import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
try{
 await client.query("SET statement_timeout='120s'");
 const indexState=(await client.query("SELECT c.relname AS name,x.indisvalid AS valid FROM pg_index x JOIN pg_class c ON c.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gcd' AND c.relname LIKE 'comichuddle_gcd_%'")).rows;console.log('GCD_INDEX_STATE '+JSON.stringify(indexState));
 const native=(await client.query("SELECT (SELECT count(*) FROM gcd.gcd_issue) AS issues,(SELECT count(DISTINCT id) FROM gcd.gcd_issue) AS distinct_issue_ids,(SELECT count(*) FROM gcd.gcd_series) AS series,(SELECT count(*) FROM gcd.gcd_publisher) AS publishers,(SELECT count(*) FROM gcd.gcd_issue WHERE COALESCE(deleted,0)=0) AS active_issues,(SELECT count(*) FROM gcd.gcd_issue i JOIN gcd.gcd_series s ON s.id=i.series_id) AS joined_issues")).rows[0];console.log('GCD_NATIVE_JOIN_DIAGNOSTIC '+JSON.stringify(native));
 console.log('GCD_NATIVE_SAMPLE '+JSON.stringify((await client.query("SELECT i.id,i.series_id,i.number,i.deleted,s.name,s.deleted AS series_deleted FROM gcd.gcd_issue i LEFT JOIN gcd.gcd_series s ON s.id=i.series_id LIMIT 6")).rows));
 const counts=(await client.query(`SELECT count(*)::bigint AS directory_issues,count(*) FILTER(WHERE gcd_id IS NOT NULL)::bigint AS gcd_issues FROM gcd.comichuddle_directory`)).rows[0];
 const coverTables=(await client.query("SELECT to_regclass('gcd.gcd_cover') IS NOT NULL AS native_cover_table,count(*)::bigint AS cover_references FROM gcd.comichuddle_cover_references WHERE status='active'")).rows[0];
 const migrations=(await client.query('SELECT name FROM ch_web.schema_migrations ORDER BY name')).rows.map(row=>row.name);
 console.log('NATIVE_DIRECTORY_VERIFIED '+JSON.stringify({asOf:new Date().toISOString(),schema:'gcd',...counts,...coverTables,migrations}));
}finally{client.release();await pool.end()}
