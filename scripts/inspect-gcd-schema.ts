import {getPool} from '../db/postgres';

// Operator build diagnostic. Never prints credentials, account data or comic payloads.
const pool=getPool();
try {
 const schemas=await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('gcd','ch_web') ORDER BY schema_name");
 const tables=await pool.query("SELECT c.relname AS name,c.reltuples::bigint AS estimated_rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gcd' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname");
 const columns=await pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='gcd' AND table_name IN ('gcd_issue','gcd_series','gcd_publisher','gcd_cover') ORDER BY table_name,ordinal_position");
 let counts:unknown=null;
 if(tables.rows.some(row=>row.name==='gcd_issue'))counts=(await pool.query('SELECT COUNT(*)::bigint AS issue_count FROM gcd.gcd_issue')).rows[0];
 console.log('GCD_SCHEMA_SUMMARY '+JSON.stringify({schemas:schemas.rows,tables:tables.rows.filter(row=>/gcd_(issue|series|publisher|cover|image)$/.test(row.name)),counts}));
 for(const table of ['gcd_issue','gcd_series','gcd_publisher','gcd_cover'])console.log('GCD_TABLE_COLUMNS '+JSON.stringify({table,columns:columns.rows.filter(row=>row.table_name===table)}));
} finally {await pool.end();}
