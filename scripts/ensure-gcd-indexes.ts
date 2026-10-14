import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
const indexes=[
 ['comichuddle_gcd_directory_id','gcd.gcd_issue','(4000000000::bigint+id)'],
 ['comichuddle_gcd_issue_id','gcd.gcd_issue','id'],
 ['comichuddle_gcd_issue_series_number','gcd.gcd_issue','series_id,number,id'],
 ['comichuddle_gcd_series_id','gcd.gcd_series','id'],
 ['comichuddle_gcd_series_publisher','gcd.gcd_series','publisher_id,id'],
 ['comichuddle_gcd_publisher_id','gcd.gcd_publisher','id'],
];
try{
 const coverColumns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='gcd' AND table_name='gcd_cover'")).rows.map(row=>row.column_name);
 if(coverColumns.includes('issue_id'))indexes.push(['comichuddle_gcd_cover_issue','gcd.gcd_cover','issue_id']);
 await client.query("SET statement_timeout='300s'; SET lock_timeout='5s'");
 const lock=(await client.query("SELECT pg_try_advisory_lock(hashtext('comichuddle-native-indexes')) AS locked")).rows[0];
 if(!lock.locked){console.log('GCD_INDEX_RESULT: another maintenance run is active; existing index checkpoint retained.');}
 let pending=0;
 if(lock.locked){
 for(const [name,table,columns] of indexes){try{
  const state=(await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',['gcd.'+name])).rows[0];
  if(state?.indisvalid===false)await client.query('DROP INDEX CONCURRENTLY gcd.'+name);
  console.log('Ensuring concurrent GCD index: '+name);
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS '+name+' ON '+table+'('+columns+')');
 }catch(error){if(['55P03','57014'].includes((error as {code?:string}).code||'')){pending++;console.log('GCD index checkpoint retained during active import: '+name);continue}throw error}}
 }
 await client.query('ANALYZE gcd.gcd_series');await client.query('ANALYZE gcd.gcd_publisher');
 console.log('GCD_INDEX_RESULT '+JSON.stringify({verified:lock.locked?indexes.length-pending:0,pending:lock.locked?pending:indexes.length,reason:pending||!lock.locked?'Concurrent snapshot activity; retry in the next maintenance build.':null}));
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-native-indexes'))");client.release();await pool.end()}
