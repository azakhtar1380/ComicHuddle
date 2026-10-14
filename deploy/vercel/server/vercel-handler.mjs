import {createHash,timingSafeEqual} from 'node:crypto';
import {createApplication} from './application.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createVercelHandler({getPool,runSync,env=process.env}){
 return async function fetchHandler(request){
  const url=new URL(request.url),mapped=url.searchParams.get('__ch_path');
  if(mapped){
   if(!/^\/(?:health|api\/[a-z/-]+)$/.test(mapped))return json({error:'Invalid route'},400);
   url.pathname=mapped;url.searchParams.delete('__ch_path');
   request=new Request(url,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half'});
  }
  if(url.pathname==='/api/cron/new-releases'){
   if(request.method!=='GET')return json({error:'Use GET'},405);
   const secret=env.CRON_SECRET,header=request.headers.get('Authorization');
   if(!secret||!header||!timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+secret).digest()))return json({error:'Unauthorized'},401);
   if(!env.SOURCE_METADATA_RIGHTS_REFERENCE||!(env.METRON_API_TOKEN||env.GCD_RELEASE_FEED_URL||env.MARVEL_RELEASE_FEED_URL))return json({status:'skipped',reason:'Authorized release feed and metadata rights configuration required.'});
   try{return json({status:'completed',...await runSync()})}catch(error){
    if(error.message?.includes('quota wait'))return json({status:'quota_wait',checkpoint:'retained'});
    console.error('ComicHuddle cron failed:',error.code||'provider_or_database_error');
    return json({error:'Release synchronization failed; checkpoint retained.'},503);
   }
  }
  try{
   const pool=await getPool(),origin=env.PUBLIC_ORIGIN||url.origin;
   return await createApplication(pool,{origin,visionEndpoint:env.VISION_GATEWAY_URL,visionKey:env.VISION_GATEWAY_KEY})(request);
  }catch(error){console.error('ComicHuddle API unavailable:',error.code||'database_configuration_error');return json({error:'Database-backed API is unavailable.'},503)}
 };
}
