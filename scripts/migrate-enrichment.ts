import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect(),name='022_coordinated_enrichment.sql';
try{
 await client.query("SET statement_timeout='60s'; SET lock_timeout='10s'");
 await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-original-migration'))");
 const source=await readFile(new URL('../db/postgres-migrations/'+name,import.meta.url),'utf8'),hash=createHash('sha256').update(source).digest('hex'),existing=await client.query('SELECT sha256 FROM ch_web.schema_migrations WHERE name=$1',[name]);
 if(existing.rows[0]){if(existing.rows[0].sha256!==hash)throw Error('Applied enrichment migration changed.');console.log('Enrichment migration already applied.');}
 else{await client.query('BEGIN');try{await client.query(source);await client.query('INSERT INTO ch_web.schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);await client.query('COMMIT');console.log('Applied additive application-only enrichment migration: '+name);}catch(error){await client.query('ROLLBACK');throw error}}
 const tables=await client.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='ch_web' AND table_name IN ('cover_cache','enrichment_jobs','valuation_snapshots','collector_listing_drafts','market_pulse_snapshots')");if(tables.rows[0].count!==5)throw Error('Enrichment table verification failed.');console.log('Enrichment schema verified; imported GCD tables unchanged.');
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-original-migration'))");client.release();await pool.end()}
