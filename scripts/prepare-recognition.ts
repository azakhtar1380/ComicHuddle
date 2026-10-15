import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
try{
 await client.query("SET statement_timeout='30s'; SET lock_timeout='8s'");
 const locked=await client.query("SELECT pg_try_advisory_lock(hashtext('comichuddle-original-migration')) AS locked");
 if(!locked.rows[0].locked)throw Error('Another migration is active; retry this schema preparation later.');
 const name='021_catalog_recognition.sql',source=await readFile(new URL('../db/postgres-migrations/'+name,import.meta.url),'utf8'),hash=createHash('sha256').update(source).digest('hex');
 const existing=await client.query('SELECT sha256 FROM ch_web.schema_migrations WHERE name=$1',[name]);
 if(existing.rows.length){if(existing.rows[0].sha256!==hash)throw Error('Recognition migration checksum mismatch.');console.log('Catalog recognition schema already applied.');}
 else{await client.query('BEGIN');try{await client.query(source);await client.query('INSERT INTO ch_web.schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);await client.query('COMMIT');console.log('Catalog recognition schema applied.');}catch(error){await client.query('ROLLBACK');throw error}}
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-original-migration'))");client.release();await pool.end()}
