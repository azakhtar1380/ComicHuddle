import {getPool} from '../db/postgres';
const pool=getPool(),client=await pool.connect();
try{
 await client.query("SET lock_timeout='5s'; SET statement_timeout='60s'");
 const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='gcd' AND table_name='gcd_cover'")).rows.map(r=>r.column_name);
 if(!columns.includes('issue_id'))console.log('GCD_NATIVE_COVERS: table or issue_id missing; exact retained references preserved.');
 else{
  // The snapshot may store an explicit URL/path. A cover ID alone is never a filename.
  await client.query(`CREATE OR REPLACE VIEW gcd.comichuddle_cover_references AS
   SELECT DISTINCT ON (issue_id) issue_id,gcd_id,image_url,source_url,attribution,status,fetched_at FROM (
    SELECT 4000000000::bigint+c.issue_id AS issue_id,c.issue_id::bigint AS gcd_id,
     COALESCE(NULLIF(to_jsonb(c)->>'image_url',''),NULLIF(to_jsonb(c)->>'cover_url',''),NULLIF(to_jsonb(c)->>'url',''),NULLIF(to_jsonb(c)->>'image_path','')) AS image_url,
     'https://www.comics.org/issue/'||c.issue_id||'/' AS source_url,
     'Cover image source: Grand Comics Database (GCD) / Publisher'::text AS attribution,
     'active'::text AS status,now() AS fetched_at,0 AS priority
    FROM gcd.gcd_cover c WHERE COALESCE(to_jsonb(c)->>'deleted','0') NOT IN ('1','true')
    UNION ALL SELECT issue_id,gcd_id,image_url,source_url,attribution,status,fetched_at,1 FROM ch_web.catalog_cover_references
   ) refs WHERE image_url IS NOT NULL ORDER BY issue_id,priority,fetched_at DESC,image_url`);
  console.log('GCD_NATIVE_COVERS: native issue mapping enabled; explicit URLs and retained references only.');
 }
}finally{client.release();await pool.end()}
