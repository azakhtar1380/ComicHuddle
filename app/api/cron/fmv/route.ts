import {createHash,timingSafeEqual} from 'node:crypto';
import {getDb} from '../../../../db';
import {syncWeeklyFmv} from '../../../../lib/weekly-fmv';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function GET(request:Request){
 const digest=(value:string)=>createHash('sha256').update(value).digest(),secret=process.env.CRON_SECRET;
 if(!secret||!timingSafeEqual(digest(request.headers.get('authorization')||''),digest('Bearer '+secret)))return Response.json({error:'Unauthorized'},{status:401});
 try{return Response.json(await syncWeeklyFmv(getDb(),process.env),{headers:{'Cache-Control':'no-store'}})}catch{console.error('Authorized FMV sync failed; provider details withheld.');return Response.json({status:'stopped',reason:'The authorized sales feed could not be verified. Existing values remain unchanged.'},{status:503})}
}
