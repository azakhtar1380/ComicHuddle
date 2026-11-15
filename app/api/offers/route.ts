// Offers & trades page API (round 4). GET: the signed-in collector's received and sent offers and trade
// proposals. POST: respond to an offer (accept / counter / decline / withdraw), decide a trade, or start
// the accepted offer's own checkout. Auth, same-origin, per-action write limits and ownership checks
// are all enforced here and in lib/offers.ts / lib/commerce.ts.
import {eq} from 'drizzle-orm';
import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readObject} from '../../../lib/api-security';
import {previewRulesVersion} from '../../../lib/community';
import {commerceError,commerceOfferCheckout,commerceParticipant,type StripeSandboxEnv} from '../../../lib/commerce';
import {decideTradeTerms} from '../../../lib/marketplace';
import {listOffersAndTrades,notifyTradeDecision,respondToOffer,tradeOpenForDecision,tradeRespondSchema} from '../../../lib/offers';

const environment=()=>env as unknown as StripeSandboxEnv;
async function profileFor(userId:string){
 const [profile]=await getDb().select().from(profiles).where(eq(profiles.userId,userId));
 if(!profile)throw new ApiRequestError('Create your free collector profile to make and receive offers.',403);
 return profile;
}
export async function GET(){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to see your offers and trades.'},401);
 return privateJson(await listOffersAndTrades(await profileFor(user.userId)));
}catch(error){return commerceError(error)}}

const budgets:Record<string,number>={respond:30,trade:30,offer_checkout:10};
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to continue.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const raw=await readObject(req,20000),action=typeof raw.action==='string'?raw.action:'';
 if(!Object.hasOwn(budgets,action))throw new ApiRequestError('That offer action isn’t available.',400);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'offers:'+action,budgets[action]);if(limited)return limited;
 if(action==='offer_checkout'){const profile=await commerceParticipant(db,user.userId);return privateJson(await commerceOfferCheckout(db,profile,user.email,raw,environment()))}
 const me=await profileFor(user.userId);
 // Same gate as /api/social: ending an offer or trade is always allowed; agreeing needs an account in good standing.
 const ending=action==='respond'&&['decline','withdraw'].includes(String(raw.decision))||action==='trade'&&['decline','cancel'].includes(String(raw.decision));
 if(!ending&&(me.moderated||me.deletionStartedAt||await isRestricted(db,user.userId)))return privateJson({error:'Your account is restricted pending moderation review.'},403);
 if(!ending&&(me.rulesVersion!==previewRulesVersion||!me.rulesAcceptedAt))return privateJson({error:'Open your collector profile and accept the current community rules before continuing.'},403);
 if(action==='respond')return privateJson(await respondToOffer(db,me,raw));
 const input=tradeRespondSchema.parse(raw);
 if(input.decision==='accept')await tradeOpenForDecision(input.proposalId);
 const result=await decideTradeTerms(db,me,{action:'trade_terms_decision',proposalId:input.proposalId,decision:input.decision,expectedVersion:input.expectedVersion,...(input.agreementOnlyConsent?{agreementOnlyConsent:true}:{})});
 await notifyTradeDecision(result.proposalId,result.status,me);
 return privateJson(result);
}catch(error){return commerceError(error)}}
