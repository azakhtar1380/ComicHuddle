// Applies additive migrations numbered 024 and later, in order, exactly once.
// Same safety model as migrate-launch.ts: advisory lock, per-migration transaction,
// sha256 checksum ledger in ch_web.schema_migrations, and refusal if an applied file changed.
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getPool} from '../db/postgres';

const FIRST=24;
const directory=new URL('../db/postgres-migrations/',import.meta.url);
const names=(await readdir(directory)).filter(name=>/^\d{3}_.+\.sql$/.test(name)&&Number(name.slice(0,3))>=FIRST).sort();
const pool=getPool(),client=await pool.connect();
try{
 await client.query("SET statement_timeout='60s';SET lock_timeout='8s'");
 await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-original-migration'))");
 for(const name of names){
  const source=await readFile(new URL(name,directory),'utf8'),hash=createHash('sha256').update(source).digest('hex');
  const applied=await client.query('SELECT sha256 FROM ch_web.schema_migrations WHERE name=$1',[name]);
  if(applied.rows[0]){if(applied.rows[0].sha256!==hash)throw Error(`Applied migration ${name} changed; create a new migration instead.`);console.log(`Migration ${name} checksum verified.`);continue}
  await client.query('BEGIN');
  try{await client.query(source);await client.query('INSERT INTO ch_web.schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);await client.query('COMMIT');console.log(`Applied additive migration ${name}.`)}
  catch(error){await client.query('ROLLBACK');throw error}
 }
 if(!names.length)console.log('No additive migrations after 023.');
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-original-migration'))");client.release();await pool.end()}
