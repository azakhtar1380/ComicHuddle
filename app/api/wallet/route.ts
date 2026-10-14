import { getChatGPTUser } from '../../chatgpt-auth';
import { getPool } from '../../../db/postgres';
import { collectorWallet } from '../../../lib/collector-wallet';
import { privateJson } from '../../../lib/api-security';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to view your wallet.'},401);
  const params=new URL(request.url).searchParams,mode=params.get('mode')||'live';if(!['live','sandbox','all'].includes(mode))return privateJson({error:'Choose a valid wallet mode.'},400);const raw=params.get('offset')||'0';if(!/^\d{1,6}$/.test(raw))return privateJson({error:'Choose a valid wallet page.'},400);
  return privateJson(await collectorWallet(getPool(),user.userId,Number(raw),mode as 'live'|'sandbox'|'all'));
 }catch{console.error('Collector wallet could not reconcile account receipts.');return privateJson({error:'Your wallet could not be loaded. Please retry.'},503)}
}
