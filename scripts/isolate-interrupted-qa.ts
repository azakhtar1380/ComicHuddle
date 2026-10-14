// One interrupted QA run on 2026-10-14 lost its transport before confirming
// cleanup. Hide only its unmistakable, empty test profiles. Authentication and
// any collection, sales, photos or financial history remain untouched.
import {getPool} from '../db/postgres';
const pool=getPool();
try{
 const result=await pool.query(`UPDATE ch_web.profiles p SET visible=0,dm_open=0
   WHERE p.created_at >= $1 AND p.created_at <= $2
   AND p.name='Temporary ComicHuddle QA' AND p.tagline='QA only'
   AND p.bio='Temporary automated QA profile. No comics or services are offered for sale.'
   AND p.handle ~ '^qa_[a-f0-9]{12}$' AND (p.visible<>0 OR p.dm_open<>0)
   AND NOT EXISTS (SELECT 1 FROM ch_web.collections c WHERE c.user_id=p.user_id)
   AND NOT EXISTS (SELECT 1 FROM ch_web.media m WHERE m.user_id=p.user_id)
   AND NOT EXISTS (SELECT 1 FROM ch_web.listings l WHERE l.seller_id=p.id)
   AND NOT EXISTS (SELECT 1 FROM ch_web.threads t WHERE t.a=p.id OR t.b=p.id)
   AND NOT EXISTS (SELECT 1 FROM ch_web.care_providers s WHERE s.profile_id=p.id)
   RETURNING p.id`,['2026-10-14T19:40:30.000Z','2026-10-14T19:43:00.000Z']);
 console.log('Interrupted empty QA profiles hidden:',result.rowCount);
}finally{await pool.end();}
