// SafePurchase quote for one listing: whether the buyer can choose it ($1,000+ item price, shipped orders) and what
// it adds (estimated shipping to our inspection address + the check fee). Public: no buyer data is involved.
import {getDb} from '../../../db';
import {env} from '../../../lib/runtime-env';
import {commerceError,safePurchaseQuote,type StripeSandboxEnv} from '../../../lib/commerce';

export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
  const id=new URL(req.url).searchParams.get('listing')||'';
  if(!/^[A-Za-z0-9-]{1,100}$/.test(id))return Response.json({error:'Choose a listing.'},{status:400});
  const quote=await safePurchaseQuote(getDb(),id,env as unknown as StripeSandboxEnv);
  return Response.json(quote,{headers:{'Cache-Control':'private, max-age=300'}});
 }catch(error){return commerceError(error)}
}
