// Saved card + shipping address for auctions (lib/saved-cards.ts). Card numbers are entered only on Stripe's page.
import {eq} from 'drizzle-orm';
import {env} from '../../../../lib/runtime-env';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {profiles} from '../../../../db/schema';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../../lib/api-security';
import {commerceError,savedCardRequiredForBids,type StripeSandboxEnv} from '../../../../lib/commerce';
import {confirmCardSchema,confirmSavedCard,removeSavedCard,saveShippingAddress,savedCardView,startSaveCard} from '../../../../lib/saved-cards';
import {stripeMode,stripePublishableKey,stripeSandbox} from '../../../../lib/stripe-sandbox';

export const dynamic='force-dynamic';
const environment=()=>env as unknown as StripeSandboxEnv;
const sandboxFlag=():0|1=>stripeMode(environment() as never)==='live'?0:1;

export async function GET(){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to see your saved card.'},401);
 return privateJson({card:await savedCardView(user.userId,sandboxFlag()),requiredForBids:savedCardRequiredForBids(environment()),sandbox:sandboxFlag()===1});
}catch(error){return commerceError(error)}}

export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to save a card.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const raw=await readObject(req,5000),action=typeof raw.action==='string'?raw.action:'';
 const budgets:Record<string,number>={save_card:10,save_address:20,confirm_card:30,remove_card:10};
 if(!Object.hasOwn(budgets,action))throw new ApiRequestError('That card action isn’t available.',400);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'saved_card:'+action,budgets[action]);if(limited)return limited;
 const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 if(!profile)throw new ApiRequestError('Create your free collector profile first.',403);
 const flag=sandboxFlag(),processor=stripeSandbox(environment());
 if(action==='save_card')return privateJson(await startSaveCard(processor,{userId:user.userId,profileId:profile.id,email:user.email,sandbox:flag,raw,publishableKey:stripePublishableKey(environment() as never)}));
 if(action==='save_address')return privateJson(await saveShippingAddress(user.userId,flag,raw));
 if(action==='confirm_card'){const value=confirmCardSchema.parse(raw);return privateJson(await confirmSavedCard(processor,user.userId,flag,value.sessionId))}
 return privateJson(await removeSavedCard(processor,user.userId,flag));
}catch(error){return commerceError(error)}}
