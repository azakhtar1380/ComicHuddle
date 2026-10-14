import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
const indexes=[
 ['comichuddle_gcd_issue_id','gcd.gcd_issue','id'],
 ['comichuddle_gcd_issue_series_number','gcd.gcd_issue','series_id,number,id'],
 ['comichuddle_gcd_series_id','gcd.gcd_series','id'],
 ['comichuddle_gcd_series_publisher','gcd.gcd_series','publisher_id,id'],
 ['comichuddle_gcd_publisher_id','gcd.gcd_publisher','id'],
] as const;
try{
 await client.query("SET statement_timeout='300s'; SET lock_timeout='30s'");
 await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-native-indexes'))");
 for(const [name,table,columns] of indexes){
  const state=(await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',['gcd.'+name])).rows[0];
  if(state?.indisvalid===false)await client.query('DROP INDEX CONCURRENTLY gcd.'+name);
  console.log('Ensuring concurrent GCD index: '+name);
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS '+name+' ON '+table+'('+columns+')');
 }
 console.log('Concurrent GCD indexes verified.');
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-native-indexes'))");client.release();await pool.end()}
