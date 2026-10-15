import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getPool} from '../db/postgres';
import {identifiersFromRecord} from '../lib/comic-identifiers';
import {syncIdentifierBatch} from '../lib/catalog-identifiers';
const pool=getPool(),client=await pool.connect(),name='023_launch_stabilization.sql';
try{
 await client.query("SET statement_timeout='45s';SET lock_timeout='8s'");await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-original-migration'))");
 const source=await readFile(new URL('../db/postgres-migrations/'+name,import.meta.url),'utf8'),hash=createHash('sha256').update(source).digest('hex'),applied=await client.query('SELECT sha256 FROM ch_web.schema_migrations WHERE name=$1',[name]);
 if(applied.rows[0]){if(applied.rows[0].sha256!==hash)throw Error('Applied launch migration changed.');console.log('Launch migration checksum verified.')}else{await client.query('BEGIN');try{await client.query(source);await client.query('INSERT INTO ch_web.schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);await client.query('COMMIT');console.log('Applied additive launch migration 023; historical catalog/financial records retained.')}catch(error){await client.query('ROLLBACK');throw error}}
 const columns=(await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='gcd' AND table_name IN ('gcd_issue','gcd_cover') AND (table_name='gcd_cover' OR column_name IN ('id','barcode','isbn','valid_isbn')) ORDER BY table_name,ordinal_position")).rows;
 const issueIds=[17099,44451,76314,1400,2506,3244,5068,6567,6841];
 const covers=columns.some(row=>row.table_name==='gcd_cover')?(await client.query(`SELECT issue_id,id,to_jsonb(c)->>'deleted' AS deleted,to_jsonb(c)->>'limit_display' AS restricted,COALESCE(to_jsonb(c)->>'image_url',to_jsonb(c)->>'cover_url',to_jsonb(c)->>'url',to_jsonb(c)->>'image_path') AS supplied_url FROM gcd.gcd_cover c WHERE issue_id=ANY($1::bigint[]) ORDER BY issue_id,id LIMIT 30`,[issueIds])).rows:[];
 const sample=(await client.query(`SELECT id,to_jsonb(i)->>'barcode' AS barcode,to_jsonb(i)->>'isbn' AS isbn,to_jsonb(i)->>'valid_isbn' AS valid_isbn FROM gcd.gcd_issue i WHERE id=ANY($1::bigint[])`,[issueIds])).rows;
 for(const row of sample)for(const code of identifiersFromRecord(row))await client.query(`INSERT INTO ch_web.directory_identifiers(issue_id,source,identifier,lookup_key,supplement,kind) VALUES($1,'GCD',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[4000000000+Number(row.id),code.identifier,code.lookupKey,code.supplement,code.kind]);
 const identifierStart=Date.now();
 for(let step=0;step<6&&Date.now()-identifierStart<45000;step++){
  const current=(await client.query("SELECT scanned_count,identifier_count FROM ch_web.directory_identifier_sync WHERE id='native-gcd'")).rows[0];
  if(current&&(Number(current.scanned_count)>=120000||Number(current.identifier_count)>=10))break;
  if((await syncIdentifierBatch(20000)).complete)break;
 }
 const identifierCoverage=(await client.query("SELECT scanned_count,matched_issue_count,identifier_count,last_issue_id,completed_at FROM ch_web.directory_identifier_sync WHERE id='native-gcd'")).rows[0];
 const identifierExamples=(await client.query('SELECT issue_id,identifier,kind,supplement FROM ch_web.directory_identifiers ORDER BY issue_id LIMIT 3')).rows;
 const photos=(await client.query("SELECT count(*)::int AS media_records,count(*) FILTER(WHERE p.key IS NOT NULL)::int AS stored_originals,count(*) FILTER(WHERE p.key IS NULL)::int AS missing_bytes FROM ch_web.media m LEFT JOIN ch_web.photo_bytes p ON p.key='photos/'||m.id")).rows[0];
 const listingPhotos=(await client.query("SELECT count(*)::int AS active_listings,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(l.photos::jsonb) x WHERE EXISTS(SELECT 1 FROM ch_web.photo_bytes b WHERE b.key='photos/'||x.value AND octet_length(b.body)>0)))::int AS missing_usable_photo FROM ch_web.listings l WHERE status='active'")).rows[0];
 const cache=(await client.query('SELECT status,count(*)::int AS count FROM ch_web.cover_cache GROUP BY status')).rows;
 const queue=(await client.query("SELECT kind,status,count(*)::int AS count FROM ch_web.enrichment_jobs GROUP BY kind,status")).rows;
 console.log('LAUNCH_DIAGNOSTIC '+JSON.stringify({observedAt:new Date().toISOString(),backend:'Vercel Node.js / AWS RDS PostgreSQL',sellerPhotoStore:'ch_web.photo_bytes; authenticated /api/media',nativeColumns:columns,coverAssociations:covers,identifierSample:sample,identifierCoverage,identifierExamples,photoIntegrity:photos,listingPhotoIntegrity:listingPhotos,coverCacheStates:cache,queueStates:queue,sourceAccessConfigured:!!(process.env.GCD_USERNAME&&process.env.GCD_PASSWORD),catalogObjectStorageConfigured:!!(process.env.COVER_STORAGE_BUCKET&&process.env.COVER_CDN_BASE_URL)}));
}finally{await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-original-migration'))");client.release();await pool.end()}
