import {getPool} from '../db/postgres';

// Operator build diagnostic. Never prints credentials, account data or comic payloads.
const pool=getPool(),client=await pool.connect();
try {
 await client.query("SET statement_timeout='60s'; SET lock_timeout='5s'");
 const schemas=await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('gcd','ch_web') ORDER BY schema_name");
 const tables=await client.query("SELECT c.relname AS name,c.reltuples::bigint AS estimated_rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gcd' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname");
 const columns=await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='gcd' AND table_name IN ('gcd_issue','gcd_series','gcd_publisher','gcd_cover','gcd_story','gcd_story_type') ORDER BY table_name,ordinal_position");
 console.log('GCD_SCHEMA_SUMMARY '+JSON.stringify({schemas:schemas.rows,tables:tables.rows.filter(row=>/gcd_(issue|series|publisher|cover|image|story|story_type)$/.test(row.name))}));
 const companions:Record<string,number|null>={};
 for(const name of ['gcd_series','gcd_publisher','gcd_cover'])companions[name]=tables.rows.some(row=>row.name===name)?Number((await client.query('SELECT count(*) AS n FROM gcd.'+name)).rows[0].n):null;
 console.log('GCD_COMPANION_COUNTS '+JSON.stringify(companions));
 console.log('GCD_COPY_PROGRESS '+JSON.stringify((await client.query("SELECT command,type,tuples_processed FROM pg_stat_progress_copy WHERE relid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gcd')")).rows));
 console.log('GCD_AVAILABLE_INDEXES '+JSON.stringify((await client.query("SELECT c.relname AS table_name,i.relname AS index_name,x.indisvalid AS valid,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gcd' AND c.relname IN ('gcd_issue','gcd_series','gcd_publisher','gcd_cover','gcd_story') ORDER BY c.relname,i.relname")).rows));
 for(const table of ['gcd_issue','gcd_series','gcd_publisher','gcd_cover','gcd_story','gcd_story_type'])console.log('GCD_TABLE_COLUMNS '+JSON.stringify({table,columns:columns.rows.filter(row=>row.table_name===table)}));
 if(tables.rows.some(row=>row.name==='gcd_issue')){
  try {console.log('GCD_EXACT_ISSUE_COUNT '+JSON.stringify((await client.query('SELECT COUNT(*)::bigint AS issue_count FROM gcd.gcd_issue')).rows[0]));}
  catch(error){if(!['57014','55P03'].includes((error as {code?:string}).code||''))throw error;console.log('GCD_EXACT_ISSUE_COUNT: deferred while snapshot database is busy; previous observed count retained.');}
 }
} finally {client.release();await pool.end();}
