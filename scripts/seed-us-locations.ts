import {readFile} from 'node:fs/promises';
import {getPool} from '../db/postgres';
const source=JSON.parse(await readFile('db/us-postal-centroids.json','utf8'));
if(source.source!=='https://download.geonames.org/export/zip/US.zip'||source.license!=='https://creativecommons.org/licenses/by/4.0/'||!/^[a-f0-9]{64}$/.test(source.archiveSha256)||!Array.isArray(source.records)||source.records.length<30000||source.records.length>60000)throw Error('Invalid reviewed postal dataset.');
const seen=new Set<string>();
for(const row of source.records){if(!/^\d{5}$/.test(row.zip)||seen.has(row.zip)||typeof row.city!=='string'||row.city.length>180||!/^[A-Z]{2}$/.test(row.state)||!Number.isFinite(row.latitude)||!Number.isFinite(row.longitude)||Math.abs(row.latitude)>90||Math.abs(row.longitude)>180)throw Error('Invalid postal centroid.');seen.add(row.zip)}
const pool=getPool(),client=await pool.connect();
try{
 await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-us-locations'))");
 const [existing]=(await client.query<{n:string|number}>("SELECT count(*) AS n FROM ch_web.us_postal_centroids WHERE source_sha256=$1",[source.archiveSha256])).rows;
 if(Number(existing.n)!==source.records.length){
  for(let start=0;start<source.records.length;start+=1000){await client.query(`INSERT INTO ch_web.us_postal_centroids(zip,city,state,latitude,longitude,accuracy,source_url,source_sha256,fetched_at)
   SELECT zip,city,state,latitude,longitude,accuracy,$2,$3,$4 FROM jsonb_to_recordset($1::jsonb) AS x(zip text,city text,state text,latitude double precision,longitude double precision,accuracy bigint)
   ON CONFLICT(zip) DO UPDATE SET city=excluded.city,state=excluded.state,latitude=excluded.latitude,longitude=excluded.longitude,
    accuracy=excluded.accuracy,source_sha256=excluded.source_sha256,fetched_at=excluded.fetched_at`,[JSON.stringify(source.records.slice(start,start+1000)),source.source,source.archiveSha256,source.fetchedAt]);}
 }
 console.log('Verified US postal centroid count: '+(await client.query('SELECT count(*) AS n FROM ch_web.us_postal_centroids')).rows[0].n);
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-us-locations'))");client.release();await pool.end()}
