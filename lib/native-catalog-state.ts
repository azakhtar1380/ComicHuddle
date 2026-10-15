import {getPool} from '../db/postgres';

/** Refresh scalar coverage in a protected job, never in a visitor page request. */
export async function refreshNativeCatalogState(){
 const client=await getPool().connect();
 try{
  await client.query("SET statement_timeout='120s'; SET lock_timeout='5s'");
  const lock=(await client.query("SELECT pg_try_advisory_lock(hashtext('comichuddle-read-state')) AS locked")).rows[0];
  if(!lock.locked)return {status:'maintenance_active'};
  const counts=(await client.query(`SELECT count(*)::bigint AS total,count(*) FILTER(WHERE gcd_id IS NOT NULL)::bigint AS gcd,
   COALESCE(jsonb_agg(id) FILTER(WHERE raw_metadata IS NULL OR raw_metadata NOT LIKE '%native_snapshot%'),'[]'::jsonb) AS retained_ids
   FROM gcd.comichuddle_directory`)).rows[0];
  const legacy=(await client.query("SELECT count(*) FILTER(WHERE metron_id IS NOT NULL)::integer AS metron,count(*) FILTER(WHERE raw_metadata LIKE '%selected_series_issue_indexes%')::integer AS partial,max(fetched_at) FILTER(WHERE gcd_id IS NOT NULL) AS last_gcd FROM ch_web.catalog_issues")).rows[0];
  const names=(await client.query("SELECT DISTINCT publisher AS name FROM ch_web.catalog_issues UNION SELECT DISTINCT p.name FROM gcd.gcd_series s JOIN gcd.gcd_publisher p ON p.id=s.publisher_id WHERE COALESCE(s.deleted,0)=0 ORDER BY name")).rows.map(r=>r.name);
  const covers=(await client.query("SELECT (SELECT count(*) FROM gcd.comichuddle_cover_references WHERE status='active')+(SELECT count(*) FROM ch_web.catalog_issues WHERE gcd_id IS NULL AND data LIKE '%/covers/%') AS n")).rows[0].n;
  const native=(await client.query("SELECT GREATEST(0,reltuples)::bigint AS n FROM pg_class WHERE oid='gcd.gcd_issue'::regclass")).rows[0].n;
  const metadata={scope:'shared',issueCount:Number(counts.total),syncedIssueCount:Number(legacy.metron),lastSyncedAt:null,gcdIssueCount:Number(counts.gcd),gcdIndexIssueCount:Number(legacy.partial),coverIssueCount:Number(covers),lastGcdSyncedAt:legacy.last_gcd,catalogSchema:'gcd',nativeIssueCountEstimate:Number(native),nativeSnapshotStatus:'All active native issue rows are accessible; unresolved metadata is labeled.',gcdCoverage:'Native snapshot and exact retained additions. Missing titles, artwork and prices are not inferred.',publishers:names,rights:'GCD metadata under CC BY-SA 4.0; artwork rights remain with publishers and artists.',coverageObservedAt:new Date().toISOString()};
  await client.query("INSERT INTO gcd.comichuddle_catalog_read_state(id,metadata,retained_ids,refreshed_at) VALUES('directory',$1::jsonb,$2::jsonb,now()) ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata,retained_ids=EXCLUDED.retained_ids,refreshed_at=EXCLUDED.refreshed_at",[JSON.stringify(metadata),JSON.stringify(counts.retained_ids)]);
  return {status:'refreshed',issueCount:metadata.issueCount,observedAt:metadata.coverageObservedAt};
 }catch(error){
  if(['57014','55P03'].includes((error as {code?:string}).code||''))return {status:'deferred',reason:'Native snapshot database is busy; previous observed counts retained.'};
  throw error;
 }finally{
  await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-read-state'))");
  await client.query("SET statement_timeout='15s'; SET lock_timeout='0'");
  client.release();
 }
}
