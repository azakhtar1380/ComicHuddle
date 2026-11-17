// Order feedback API (eBay model).
// GET ?profile=<profileId> | ?handle=<handle>  → public allowlisted summary (no order ids, amounts or user ids)
// GET ?order=<orderId>                          → private status for a buyer/seller of that order
// POST {action:'leave',orderId,rating,...}      → buyer→seller (P/N/N + details) or seller→buyer (positive only)
// POST {action:'reply',feedbackId,reply}        → seller's one public reply
import {queueTrophies} from '../../../../lib/trophies';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getPool} from '../../../../db/postgres';
import {getDb} from '../../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../../lib/api-security';
import {FeedbackError,feedbackStatus,feedbackSummary,leaveFeedback,replyToFeedback,validateFeedback} from '../../../../lib/community-feedback';
export const dynamic='force-dynamic';

function failure(error:unknown){
 if(error instanceof FeedbackError)return privateJson({error:error.message,code:error.code},error.status);
 if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);
 if((error as {code?:string})?.code==='42P01')return privateJson({error:'Feedback is not available yet.'},503);
 console.error('Order feedback failed.');return privateJson({error:'Feedback could not be loaded. Please retry.'},500);
}

export async function GET(request:Request){try{
 const params=new URL(request.url).searchParams,pool=getPool();
 const order=params.get('order');
 if(order){const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to leave feedback.'},401);return privateJson(await feedbackStatus(pool,user.userId,order))}
 let profileId=params.get('profile')||'';const handle=params.get('handle');
 if(!profileId&&handle){const row=(await pool.query<{id:string}>('SELECT id FROM ch_web.profiles WHERE handle=$1 AND moderated=0',[handle.toLowerCase()])).rows[0];profileId=row?.id||''}
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(profileId))return privateJson({error:'Collector not found.'},404);
 const limit=Number(params.get('limit')||10);
 return privateJson(await feedbackSummary(pool,profileId,new Date(),Number.isInteger(limit)?limit:10));
}catch(error){return failure(error)}}

export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to leave feedback.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const limited=await enforceWriteLimits(getDb(),user.userId,'feedback',20);if(limited)return limited;
 const body=await readObject(request,4000);
 if(body.action==='reply'){
  if(typeof body.feedbackId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(body.feedbackId))return privateJson({error:'Feedback not found.'},404);
  return privateJson(await replyToFeedback(getPool(),user.userId,body.feedbackId,typeof body.reply==='string'?body.reply:''));
 }
 if(body.action==='leave'){const input=validateFeedback(body),saved=await leaveFeedback(getPool(),user.userId,input);
  // The reviewed member's Five Star / Trusted Seller may change.
  void getPool().query<{buyer_user_id:string;seller_user_id:string}>('SELECT buyer_user_id,seller_user_id FROM ch_web.commerce_orders WHERE id=$1',[input.orderId]).then(r=>queueTrophies(r.rows.flatMap(o=>[o.buyer_user_id,o.seller_user_id]))).catch(()=>undefined);
  return privateJson(saved)}
 return privateJson({error:'Unknown action.'},400);
}catch(error){return failure(error)}}
