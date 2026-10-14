import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
const indexes=[
 ['comichuddle_gcd_directory_id','gcd.gcd_issue','(4000000000::bigint+id)'],
 ['comichuddle_gcd_issue_id','gcd.gcd_issue','id'],
 ['comichuddle_gcd_issue_series_number','gcd.gcd_issue','series_id,number,id'],
 ['comichuddle_gcd_series_id','gcd.gcd_series','id'],
 ['comichuddle_gcd_series_publisher','gcd.gcd_series','publisher_id,id'],
 ['comichuddle_gcd_publisher_id','gcd.gcd_publisher','id'],
] as const;
try{
 await client.query("SET statement_timeout='300s'; SET lock_timeout='5s'");
 await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-native-indexes'))");
 let pending=0;
 for(const [name,table,columns] of indexes){try{
  const state=(await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',['gcd.'+name])).rows[0];
  if(state?.indisvalid===false)await client.query('DROP INDEX CONCURRENTLY gcd.'+name);
  console.log('Ensuring concurrent GCD index: '+name);
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS '+name+' ON '+table+'('+columns+')');
 }catch(error){if(['55P03','57014'].includes((error as {code?:string}).code||'')){pending++;console.log('GCD index checkpoint retained during active import: '+name);continue}throw error}}
 console.log('GCD_INDEX_RESULT '+JSON.stringify({verified:indexes.length-pending,pending,reason:pending?'Concurrent snapshot activity; retry in the next maintenance build.':null}));
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-native-indexes'))");client.release();await pool.end()}
