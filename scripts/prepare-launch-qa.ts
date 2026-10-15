/** Creates a small, isolated database on the existing RDS instance. Never drops
 * or empties a database. This script may only run for a Vercel preview build. */
import {Pool} from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getMigrations} from 'better-auth/db/migration';
import {betterAuth} from 'better-auth';
import {authOptions} from '../lib/auth';
import {getDb} from '../db';
import {getPool} from '../db/postgres';
import {seedStarterStatements} from '../lib/catalog-store';
import {profiles,commerceSellers} from '../db/schema';
import {previewRulesVersion} from '../lib/community';
import {eq} from 'drizzle-orm';
const target='comichuddle_launch_qa_20261015';
if(process.env.VERCEL_ENV!=='preview'||process.env.DB_NAME!==target||process.env.NEXT_PUBLIC_QA_ENV!=='true')throw Error('QA initialization refused outside the named isolated preview database.');
const settings={host:process.env.DB_HOST,port:5432,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:{ca:await readFile('certificates/rds-ca.pem','utf8'),rejectUnauthorized:true},max:2,connectionTimeoutMillis:15000};
const source=new Pool({...settings,database:'postgres'});
try{
 const existing=await source.query('SELECT datname FROM pg_database WHERE datname=$1',[target]);
 if(!existing.rows.length)await source.query('CREATE DATABASE '+target);
 const pool=getPool(),client=await pool.connect();
 try{
  await client.query("SET statement_timeout='90s'");await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-qa-setup'))");
  const present=await client.query("SELECT to_regclass('gcd.gcd_issue') AS ready");
  if(!present.rows[0].ready){await client.query(`CREATE SCHEMA gcd;CREATE TABLE gcd.gcd_publisher(id integer,name text,deleted integer);CREATE TABLE gcd.gcd_series(id integer,name text,publisher_id integer,deleted integer);CREATE TABLE gcd.gcd_issue(id integer,series_id integer,number text,publication_date text,key_date text,on_sale_date text,price text,page_count numeric,isbn text,barcode text,title text,volume text,variant_of_id integer,variant_name text,rating text,editing text,indicia_frequency text,notes text,created text,modified text,deleted integer);CREATE TABLE gcd.gcd_cover(id integer,issue_id integer,deleted integer,limit_display integer);`);
   const ids=[1400,2506,3244,5068,6567,6841,17099,44451,76314];
   const issues=(await source.query('SELECT to_jsonb(i) AS row FROM gcd.gcd_issue i WHERE id=ANY($1::bigint[])',[ids])).rows.map(item=>item.row),seriesIds=[...new Set(issues.map(row=>row.series_id))],series=(await source.query('SELECT to_jsonb(s) AS row FROM gcd.gcd_series s WHERE id=ANY($1::bigint[])',[seriesIds])).rows.map(item=>item.row),publisherIds=[...new Set(series.map(row=>row.publisher_id))],publishers=(await source.query('SELECT to_jsonb(p) AS row FROM gcd.gcd_publisher p WHERE id=ANY($1::bigint[])',[publisherIds])).rows.map(item=>item.row);
   for(const [table,rows] of [['gcd_publisher',publishers],['gcd_series',series],['gcd_issue',issues]] as const){const fields=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'gcd\' AND table_name=$1 ORDER BY ordinal_position',[table])).rows.map(row=>row.column_name);for(const row of rows){const values=fields.map(field=>row[field]===undefined?null:typeof row[field]==='boolean'?Number(row[field]):row[field]);await client.query('INSERT INTO gcd.'+table+'('+fields.map(field=>'"'+field+'"').join(',')+') VALUES('+fields.map((_field,index)=>'$'+(index+1)).join(',')+')',values)}}
  }
  await client.query('CREATE SCHEMA IF NOT EXISTS ch_web');await client.query('CREATE TABLE IF NOT EXISTS ch_web.schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir('db/postgres-migrations')).filter(name=>name.endsWith('.sql')).sort()){const bytes=await readFile('db/postgres-migrations/'+name,'utf8'),hash=createHash('sha256').update(bytes).digest('hex'),applied=await client.query('SELECT sha256 FROM ch_web.schema_migrations WHERE name=$1',[name]);if(applied.rows[0]){if(applied.rows[0].sha256!==hash)throw Error('QA migration checksum changed.');continue}await client.query('BEGIN');try{await client.query(bytes);await client.query('INSERT INTO ch_web.schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}}
  await client.query('SET search_path=ch_web,gcd,public');
  await(await getMigrations(authOptions(pool))).runMigrations();await getDb().batch(seedStarterStatements(getDb(),new Date().toISOString()));
  const password=process.env.QA_TEST_PASSWORD;if(!password||password.length<20)throw Error('Secure QA fixture password is not configured.');
  const auth=betterAuth(authOptions(pool)),db=getDb();
  for(const role of ['seller','buyer','outsider']){
   const email='qa.'+role+'@comichuddle.example.invalid',found=await pool.query('SELECT id FROM ch_web."user" WHERE email=$1',[email]);
   const userId=found.rows[0]?.id||(await auth.api.signUpEmail({body:{email,password,name:'QA '+role+' · TEST DATA'},headers:new Headers({Origin:process.env.BETTER_AUTH_URL!})})).user.id;
   const current=await db.select().from(profiles).where(eq(profiles.userId,userId));
   if(!current.length){const stamp=new Date().toISOString();await db.insert(profiles).values({id:crypto.randomUUID(),userId,handle:'qa_launch_'+role,name:'QA '+role+' · TEST DATA',bio:'Isolated test fixture. No actual comic, service or sale is offered.',tagline:'SANDBOX QA ONLY',location:'Minneapolis, MN',favorite:'Sandbox verification',since:2026,color:'blue',featured:'[]',visible:1,dmOpen:1,createdAt:stamp,rulesVersion:previewRulesVersion,rulesAcceptedAt:stamp})}
  }
  console.log('Isolated launch QA database initialized with a small real catalog sample. Production rows were read only. No test financial records were inserted into production.');
 }finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-qa-setup'))");client.release();await pool.end()}
}finally{await source.end()}
