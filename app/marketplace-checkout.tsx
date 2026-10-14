'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CreditCard,LockKeyhole,RefreshCw,ShieldCheck} from 'lucide-react';

export type CheckoutSetup={enabled:boolean;ready:boolean;checkoutEnabled:boolean;reason:string};
export type PaymentConfiguration={setup:CheckoutSetup;sandbox:boolean;carrierConnected:boolean;payoutsEnabled:boolean;productionPaymentsEnabled:boolean};

function configuration(value:unknown):PaymentConfiguration{
 if(!value||typeof value!=='object')throw Error('Payment configuration could not be read.');
 const data=value as PaymentConfiguration;
 if(!data.setup||typeof data.setup.checkoutEnabled!=='boolean'||typeof data.setup.reason!=='string'||typeof data.sandbox!=='boolean')throw Error('Payment configuration could not be verified.');
 return data;
}
export function usePaymentConfiguration(){
 const [data,setData]=useState<PaymentConfiguration|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const mounted=useRef(false),request=useRef(0),controller=useRef<AbortController|null>(null);
 const reload=useCallback(async()=>{
  const id=++request.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const timeout=setTimeout(()=>abort.abort(),15000);setLoading(true);setError('');
  try{const response=await fetch('/api/commerce?kind=setup',{cache:'no-store',credentials:'same-origin',signal:abort.signal});if(!response.ok)throw Error('Payment availability could not be checked.');const next=configuration(await response.json());if(mounted.current&&id===request.current)setData(next)}
  catch(problem){if(mounted.current&&id===request.current)setError(abort.signal.aborted?'Payment check timed out. Retry to check again.':problem instanceof Error?problem.message:'Payment availability could not be checked.')}
  finally{clearTimeout(timeout);if(mounted.current&&id===request.current)setLoading(false)}
 },[]);
 useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false;request.current++;controller.current?.abort()}},[reload]);
 return {data,error,loading,reload};
}

function paymentUrl(value:unknown){
 if(typeof value!=='string')throw Error('Your order needs review in Orders before payment can continue.');
 const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password||url.port)throw Error('The secure payment link could not be verified.');return url.href;
}
export default function MarketplaceCheckout({listingId,onNotice,requiresInspection=false,onInspectionRequest}:{listingId:string;onNotice:(text:string)=>void;requiresInspection?:boolean;onInspectionRequest?:()=>void}){
 const {data,error:setupError,loading,reload}=usePaymentConfiguration();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true),generation=useRef(0),inFlight=useRef(false),intent=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{mounted.current=true;generation.current++;intent.current=null;setError('');setBusy(false);return()=>{mounted.current=false;generation.current++}},[listingId]);
 const available=!!data?.setup.checkoutEnabled&&!setupError&&!requiresInspection;
 async function checkout(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current||!available)return;
  const token=generation.current,form=new FormData(event.currentTarget),shippingAddress={name:String(form.get('name')||'').trim(),line1:String(form.get('line1')||'').trim(),line2:String(form.get('line2')||'').trim(),city:String(form.get('city')||'').trim(),state:String(form.get('state')||'').toUpperCase().trim(),postalCode:String(form.get('postalCode')||'').trim(),country:'US'};
  const key=JSON.stringify({listingId,shippingAddress});if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
  inFlight.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/commerce',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'checkout',listingId,requestId:intent.current.id,sandboxAcknowledged:form.get('sandbox')==='on',shippingAddress})});
   const result=await response.json() as {error?:string;checkoutUrl?:string};if(!response.ok)throw Error(result.error||'Checkout could not start. Please retry.');
   if(!mounted.current||token!==generation.current)return;
   const url=paymentUrl(result.checkoutUrl);onNotice('Opening secure Stripe test checkout. Use test payment details only.');window.location.assign(url);
  }catch(problem){if(mounted.current&&token===generation.current)setError(problem instanceof Error?problem.message:'Checkout could not start. Please retry.')}
  finally{inFlight.current=false;if(mounted.current&&token===generation.current)setBusy(false)}
 }
 return <div className="marketplace-checkout">
  <h4>Payment</h4><div className="checkout-payments" aria-label="Processor-supported payment methods"><span><CreditCard size={16}/> Credit / debit card</span><span>Apple Pay</span></div>
  <p className="data-caption">Enter card details on Stripe’s secure checkout. Apple Pay appears on eligible devices with a supported card.</p>
  {(loading||setupError||!data?.setup.checkoutEnabled||requiresInspection)&&<div className="checkout-status" role={setupError?'alert':'status'}>
   <strong>{requiresInspection?'SafePurchase inspection comes first':setupError?'Payment check unavailable':loading?'Checking payment availability…':'Payments need operator setup'}</strong>
   <p>{requiresInspection?'This listing requests middleman inspection. Agree the inspection and service terms before paying or shipping.':setupError||(!loading?'ComicHuddle’s Stripe account and signed payment webhooks are not configured. No payment has been taken.':'Your purchase summary and seller contact remain available.')}</p>
   {requiresInspection&&onInspectionRequest?<button type="button" className="inline-button" onClick={onInspectionRequest}><ShieldCheck size={15}/> Request SafePurchase inspection</button>:<button type="button" className="inline-button" disabled={loading} onClick={()=>void reload()}><RefreshCw size={15}/> {loading?'Checking…':'Retry payment check'}</button>}
  </div>}
  <details className="checkout-address" open={available}><summary>Delivery address · USA shipping</summary>
   <form className="sandbox-checkout" onSubmit={event=>void checkout(event)}>
    <p className="data-caption">Fields marked <span className="required-mark">*</span> are required.</p>
    <label><span>Recipient name <span className="required-mark" aria-hidden="true">*</span></span><input name="name" autoComplete="shipping name" required maxLength={100}/></label>
    <label><span>Street address <span className="required-mark" aria-hidden="true">*</span></span><input name="line1" autoComplete="shipping address-line1" required maxLength={160}/></label>
    <label>Apartment / unit (optional)<input name="line2" autoComplete="shipping address-line2" maxLength={100}/></label>
    <div className="form-grid"><label><span>City <span className="required-mark" aria-hidden="true">*</span></span><input name="city" autoComplete="shipping address-level2" required maxLength={80}/></label><label><span>State <span className="required-mark" aria-hidden="true">*</span></span><input name="state" autoComplete="shipping address-level1" required pattern="[A-Za-z]{2}" maxLength={2}/></label><label><span>ZIP code <span className="required-mark" aria-hidden="true">*</span></span><input name="postalCode" autoComplete="shipping postal-code" inputMode="numeric" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10}/></label></div>
    <label className="check-label"><input name="sandbox" type="checkbox" required/><span>I understand this preview uses test funds. I will use Stripe test payment details. <span className="required-mark" aria-hidden="true">*</span></span></label>
    {error&&<p className="network-error" role="alert">{error} <a href="/?section=Orders">View Orders</a></p>}
    <button className="button red checkout-submit" disabled={busy||!available}>{busy?'Opening checkout…':'Continue to secure test payment'}<ArrowUpRight size={16}/></button>
   </form>
  </details>
  <p className="checkout-security"><LockKeyhole size={13}/> ComicHuddle does not collect or store card numbers. A checkout redirect alone never confirms payment.</p>
 </div>;
}
