import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
import {commerceError,commerceParticipant,type StripeSandboxEnv} from '../../../lib/commerce';
import {CartUnavailableError,guestCartView,addToCart,cartCheckout,cartIds,cartView,mergeGuestCart,removeFromCart,setSavedForLater} from '../../../lib/cart';

const environment=()=>env as unknown as StripeSandboxEnv;

export async function GET(req:Request){try{
 const user=await getChatGPTUser(),kind=new URL(req.url).searchParams.get('kind');
 // A guest's cart lives in their browser; ?kind=guest&ids=… returns the public details of those listings.
 if(!user&&kind==='guest'){const ids=(new URL(req.url).searchParams.get('ids')||'').split(',').filter(Boolean);return privateJson(await guestCartView(ids,environment()))}
 if(!user)return privateJson({signedIn:false,count:0,listingIds:[],savedIds:[],holds:0});
 if(kind==='count'){try{return privateJson({signedIn:true,...await cartIds(user.userId)})}catch(error){if(error instanceof CartUnavailableError)return privateJson({signedIn:true,count:0,listingIds:[],savedIds:[],holds:0,unavailable:true});throw error}}
 return privateJson(await cartView(getDb(),user.userId,environment()));
}catch(error){return commerceError(error)}}

// Same strictness as /api/commerce: session, same-origin, per-action rate limits, owner-scoped rows.
const budgets:Record<string,number>={add:60,remove:60,save_for_later:60,move_to_cart:60,merge:5,checkout:3};
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to ComicHuddle to use your cart.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const raw=await readObject(req,25000),action=typeof raw.action==='string'?raw.action:'unknown';
 if(!Object.hasOwn(budgets,action))throw new ApiRequestError('That cart action isn’t available.',400);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'cart:'+action,budgets[action]);if(limited)return limited;
 if(action==='add')return privateJson(await addToCart(user.userId,raw.listingId,raw.saveForLater===true));
 if(action==='remove')return privateJson(await removeFromCart(user.userId,raw.listingId));
 if(action==='save_for_later')return privateJson(await setSavedForLater(user.userId,raw.listingId,true));
 if(action==='move_to_cart')return privateJson(await setSavedForLater(user.userId,raw.listingId,false));
 if(action==='merge')return privateJson(await mergeGuestCart(user.userId,raw.listingIds));
 // Checkout also spends the regular checkout budget, so the cart can't be used to bypass it.
 const checkoutLimited=await enforceWriteLimits(db,user.userId,'commerce:checkout',10);if(checkoutLimited)return checkoutLimited;
 const profile=await commerceParticipant(db,user.userId);
 return privateJson(await cartCheckout(db,profile,user.email,raw,environment()));
}catch(error){return commerceError(error)}}
