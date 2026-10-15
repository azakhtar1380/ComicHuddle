import {getPool} from '../db/postgres';

// Keep search maintenance independent of longer snapshot/join maintenance.
// CONCURRENTLY must run outside a migration transaction.
const pool=getPool(),client=await pool.connect();
try {
 await client.query("SET statement_timeout='300s'; SET lock_timeout='90s'");
 const locked=(await client.query("SELECT pg_try_advisory_lock(hashtext('comichuddle-native-search-indexes')) AS locked")).rows[0]?.locked;
 if(!locked)throw new Error('Native search index maintenance is already running.');
 await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
 for(const [name,definition] of [
  ['comichuddle_gcd_issue_number_lookup','ON gcd.gcd_issue(lower(number),id)'],
  ['comichuddle_gcd_issue_title_search','ON gcd.gcd_issue USING gin(lower(title) gin_trgm_ops)'],
  ['comichuddle_gcd_series_name_search','ON gcd.gcd_series USING gin(lower(name) gin_trgm_ops)'],
 ]) {
  const state=(await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',['gcd.'+name])).rows[0];
  if(state?.indisvalid===false)await client.query('DROP INDEX CONCURRENTLY gcd.'+name);
  console.log('Ensuring concurrent native search index: '+name);
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS '+name+' '+definition);
 }
 await client.query('ANALYZE gcd.gcd_issue');
 await client.query('ANALYZE gcd.gcd_series');
 console.log('GCD_SEARCH_INDEXES_READY');
} finally {
 await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-native-search-indexes'))");
 client.release();await pool.end();
}
