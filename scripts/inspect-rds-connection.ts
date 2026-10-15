import {getPool} from '../db/postgres';

// Build-only operational probe: no credentials, addresses, user records or
// query text are printed. No sessions are canceled or terminated.
const pool=getPool(),started=Date.now();
try {
 const client=await pool.connect();
 try {
  await client.query("SET statement_timeout='10s'");
  const readiness=(await client.query("SELECT 1 AS ready,current_setting('max_connections')::integer AS max_connections")).rows[0];
  const activity=(await client.query("SELECT COALESCE(state,'internal') AS state,count(*)::integer AS connections FROM pg_stat_activity WHERE datname=current_database() GROUP BY state ORDER BY state")).rows;
  console.log('RDS_CONNECTION_PROBE '+JSON.stringify({connected:readiness.ready===1,elapsedMs:Date.now()-started,maxConnections:readiness.max_connections,activity}));
 }finally{client.release();}
}catch(error){
 const e=error as {code?:string;message?:string};
 console.log('RDS_CONNECTION_PROBE '+JSON.stringify({connected:false,elapsedMs:Date.now()-started,code:e.code||'unavailable',timeout:/timeout/i.test(e.message||'')}));
}finally{await pool.end();}
