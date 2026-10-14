import { getChatGPTUser } from '../../chatgpt-auth';
import { getPool } from '../../../db/postgres';
import { collectorWallet } from '../../../lib/collector-wallet';
import { privateJson } from '../../../lib/api-security';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to view your wallet.'},401);
  const raw=new URL(request.url).searchParams.get('offset')||'0';if(!/^\d{1,6}$/.test(raw))return privateJson({error:'Choose a valid wallet page.'},400);
  return privateJson(await collectorWallet(getPool(),user.userId,Number(raw)));
 }catch{console.error('Collector wallet could not reconcile account receipts.');return privateJson({error:'Your wallet could not be loaded. Please retry.'},503)}
}
