import { getChatGPTUser } from '../../chatgpt-auth';
import { getPool } from '../../../db/postgres';
import { collectorWallet } from '../../../lib/collector-wallet';
import {collectorRewards,convertPoints} from '../../../lib/collector-rewards';
import {getDb} from '../../../db';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {ApiRequestError,enforceWriteLimits,readObject} from '../../../lib/api-security';
import { privateJson } from '../../../lib/api-security';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to view your wallet.'},401);
  const params=new URL(request.url).searchParams,mode=params.get('mode')||'live';if(!['live','sandbox','all'].includes(mode))return privateJson({error:'Choose a valid wallet mode.'},400);const raw=params.get('offset')||'0';if(!/^\d{1,6}$/.test(raw))return privateJson({error:'Choose a valid wallet page.'},400);
  const wallet=await collectorWallet(getPool(),user.userId,Number(raw),mode as 'live'|'sandbox'|'all');
  return privateJson({...wallet,rewards:await collectorRewards(getPool(),user.userId,mode==='sandbox'?'sandbox':'live')});
 }catch{console.error('Collector wallet could not reconcile account receipts.');return privateJson({error:'Your wallet could not be loaded. Please retry.'},503)}
}

const conversion=z.object({action:z.literal('convert_points'),mode:z.enum(['live','sandbox']),requestId:z.string().uuid(),points:z.number().int().min(100).max(1000000).multipleOf(100)}).strict();
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to use Collector Rewards.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);
 const limited=await enforceWriteLimits(getDb(),user.userId,'wallet:convert',10);if(limited)return limited;
 const profile=await getDb().execute(sql`SELECT id FROM ch_web.profiles WHERE user_id=${user.userId} AND moderated=0 AND deletion_started_at IS NULL`);if(!profile.rows.length)return privateJson({error:'Create an active collector profile first.'},403);
 const input=conversion.safeParse(await readObject(request,4000));if(!input.success)return privateJson({error:'Choose reward points in blocks of 100.'},400);
 return privateJson({rewards:await convertPoints(getPool(),user.userId,input.data.mode,input.data.requestId,input.data.points)});
}catch(error){if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);if((error as {code?:string}).code==='22023')return privateJson({error:'Not enough points, or this conversion was already used. Refresh your wallet.'},409);return privateJson({error:'Rewards conversion could not complete. Refresh before retrying.'},503)}}
