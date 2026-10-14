import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function database(env=process.env){
 for(const name of ['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])if(!env[name])throw Error('Missing '+name);
 if(env.DB_SSL!=='true'||!env.DB_SSL_CA_PATH)throw Error('RDS requires DB_SSL=true and a trusted DB_SSL_CA_PATH.');
 return new pg.Pool({host:env.DB_HOST,port:Number(env.DB_PORT),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,ssl:{rejectUnauthorized:true,servername:env.DB_HOST,ca:await readFile(env.DB_SSL_CA_PATH,'utf8')}});
}
export async function migrate(pool){
 const c=await pool.connect();try{
  await c.query("SELECT pg_advisory_lock(hashtextextended('comichuddle-deployment-migration',0))");
  await c.query('CREATE SCHEMA IF NOT EXISTS ch_deploy');await c.query('CREATE TABLE IF NOT EXISTS ch_deploy.migrations(name text PRIMARY KEY,sha256 text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now())');
  for(const name of ['001-platform.sql','002-roles-and-guards.sql','003-moderation-and-migration.sql']){
   const source=await readFile(new URL('../platform/sql/'+name,import.meta.url),'utf8'),hash=createHash('sha256').update(source).digest('hex');
   const previous=(await c.query('SELECT sha256 FROM ch_deploy.migrations WHERE name=$1',[name])).rows[0];if(previous){if(previous.sha256!==hash)throw Error('Migration checksum changed: '+name);continue;}
   if(name==='001-platform.sql'&&(await c.query("SELECT to_regnamespace('ch_platform') AS existing")).rows[0].existing)throw Error('Existing ch_platform needs a reviewed migration baseline; no automatic overwrite.');
   await c.query('BEGIN');try{await c.query(source.replace(/^\s*(BEGIN|COMMIT);\s*$/gm,''));await c.query('INSERT INTO ch_deploy.migrations(name,sha256) VALUES($1,$2)',[name,hash]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e;}
  }
  await c.query(`CREATE SCHEMA IF NOT EXISTS ch_demo;CREATE TABLE IF NOT EXISTS ch_demo.sessions(id text PRIMARY KEY,state jsonb NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day');CREATE TABLE IF NOT EXISTS ch_demo.releases(source text NOT NULL,source_id text NOT NULL,metadata jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source,source_id))`);
 }finally{await c.query("SELECT pg_advisory_unlock(hashtextextended('comichuddle-deployment-migration',0))").catch(()=>{});c.release();}
}
