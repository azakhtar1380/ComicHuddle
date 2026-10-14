import {getPool} from '../db/postgres';
const pool=getPool();
try{
 const counts=(await pool.query(`SELECT count(*)::bigint AS directory_issues,count(*) FILTER(WHERE gcd_id IS NOT NULL)::bigint AS gcd_issues FROM gcd.comichuddle_directory`)).rows[0];
 const coverTables=(await pool.query("SELECT to_regclass('gcd.gcd_cover') IS NOT NULL AS native_cover_table,count(*)::bigint AS cover_references FROM gcd.comichuddle_cover_references WHERE status='active'")).rows[0];
 const migrations=(await pool.query('SELECT name FROM ch_web.schema_migrations ORDER BY name')).rows.map(row=>row.name);
 console.log('NATIVE_DIRECTORY_VERIFIED '+JSON.stringify({asOf:new Date().toISOString(),schema:'gcd',...counts,...coverTables,migrations}));
}finally{await pool.end()}
