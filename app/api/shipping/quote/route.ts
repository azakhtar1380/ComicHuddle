// Calculated shipping quote for one listing: GET ?listingId=&zip= → {options:[{id,carrier,service,cents,days}], package}.
// Signed-in only and rate-limited (each call asks EasyPost). Checkout re-quotes on the server; this is for display.
import {and,eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {listings} from '../../../../db/schema';
import {enforceWriteLimits,privateJson} from '../../../../lib/api-security';
import {parcelFor,quoteShippingRates,ShippingQuoteError} from '../../../../lib/shipping-rates';

export const runtime='nodejs';export const dynamic='force-dynamic';

export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to see shipping rates.'},401);
  const url=new URL(req.url),listingId=url.searchParams.get('listingId')||'',zip=(url.searchParams.get('zip')||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(listingId))return privateJson({error:'Choose a listing.'},400);
  if(!/^\d{5}$/.test(zip))return privateJson({error:'Enter a 5-digit US ZIP code.'},400);
  const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'shipping:quote',60);if(limited)return limited;
  const [listing]=await db.select().from(listings).where(and(eq(listings.id,listingId),eq(listings.status,'active')));
  if(!listing)return privateJson({error:'That listing isn’t available.'},404);
  if(listing.fulfillment==='pickup')return privateJson({error:'This comic is local pickup only.'},409);
  if(listing.shippingCalculated!==1)return privateJson({options:[{id:'flat',carrier:'',service:listing.shipping?'Shipping':'Free shipping',cents:listing.shipping,days:null}],flat:true});
  const parcel=parcelFor({kind:listing.kind,itemCount:listing.itemCount,cert:listing.cert,items:JSON.parse(listing.items||'[]')});
  const options=await quoteShippingRates({EASYPOST_API_KEY:process.env.EASYPOST_API_KEY},listing.locationZip,zip,parcel);
  return privateJson({options,package:parcel.label,from:[listing.locationCity,listing.locationState].filter(Boolean).join(', ')});
 }catch(error){
  if(error instanceof ShippingQuoteError)return privateJson({error:error.message},422);
  return privateJson({error:'Shipping rates couldn’t be loaded. Please try again.'},500);
 }
}
