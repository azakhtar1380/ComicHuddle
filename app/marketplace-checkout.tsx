'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
const StripePaymentElement=dynamic(()=>import('./stripe-payment-element'),{ssr:false,loading:()=> <p role="status">Loading secure payment form…</p>});
import {ArrowUpRight,CreditCard,LockKeyhole,RefreshCw,ShieldCheck} from 'lucide-react';
import './commerce-fees.css';

export type CheckoutSetup={enabled:boolean;ready:boolean;checkoutEnabled:boolean;reason:string};
export type ProtectionSettings={safePurchaseEnabled:boolean;safePurchaseThresholdCents:number;safePurchaseFeeCents:number;safePurchaseReleaseHoldHours:number;standardReleaseHoldHours:number;handlingBusinessDays:number;claimDays:number};
export type PaymentConfiguration={publishableKey?:string|null;paymentElementEnabled?:boolean;setup:CheckoutSetup;sandbox:boolean;mode?:'test'|'live';carrierConnected:boolean;payoutsEnabled:boolean;productionPaymentsEnabled:boolean;protection?:ProtectionSettings};
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
/** Which protection an order of this value gets, before payment. Mirrors lib/commerce-protection.ts. */
export function protectionPreview(settings:ProtectionSettings|undefined,itemCents:number,sellerOptIn:boolean){
 const threshold=settings?.safePurchaseThresholdCents??50000,over=itemCents>=threshold,enabled=!!settings?.safePurchaseEnabled;
 return {over,enabled,threshold,automatic:over&&enabled,offered:enabled&&(over||sellerOptIn),comingSoon:!enabled&&(over||sellerOptIn),feeCents:settings?.safePurchaseFeeCents??0,spHold:settings?.safePurchaseReleaseHoldHours??48,standardHold:settings?.standardReleaseHoldHours??72,handlingDays:settings?.handlingBusinessDays??3,claimDays:settings?.claimDays??30};
}
export function SafePurchaseSteps({fee}:{fee:number}){return <ol className="safepurchase-steps"><li>You pay. ComicHuddle holds the payment.</li><li>The seller ships to the ComicHuddle Inspection Center within 48 hours, insured.</li><li>Inspectors check the edition, printing, grade and every book in a collection within 2 business days.</li><li>Passed books ship to you insured, signature required. If it fails, you get a full refund automatically.</li><li>You have 48 hours after delivery to report a problem; then the seller is paid.</li>{fee>0&&<li>Inspection fee: {usd(fee)}, shown in your total.</li>}</ol>}

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
type CheckoutProps={listingId:string;onNotice:(text:string)=>void;requiresInspection?:boolean;onInspectionRequest?:()=>void;fulfillmentOptions?:('shipping'|'pickup')[];itemCents?:number;shippingCents?:number;sellerSafePurchase?:boolean};
export default function MarketplaceCheckout({listingId,onNotice,requiresInspection=false,onInspectionRequest,fulfillmentOptions=['shipping'],itemCents=0,shippingCents=0,sellerSafePurchase=false}:CheckoutProps){
 const {data,error:setupError,loading,reload}=usePaymentConfiguration();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[credit,setCredit]=useState('0'),[creditBalance,setCreditBalance]=useState<number|null>(null),[payment,setPayment]=useState<{clientSecret:string;publishableKey:string;orderId:string}|null>(null);
 const [reservedUntil,setReservedUntil]=useState<number|null>(null),[clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{if(reservedUntil===null)return;const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[reservedUntil]);
 const [fulfillment,setFulfillment]=useState<'shipping'|'pickup'>(fulfillmentOptions[0]||'shipping'),[buyerSafePurchase,setBuyerSafePurchase]=useState(false),[waive,setWaive]=useState(false);
 const preview=protectionPreview(data?.protection,itemCents,sellerSafePurchase),safePurchase=preview.enabled&&(preview.over||sellerSafePurchase||buyerSafePurchase)&&!(fulfillment==='pickup'&&waive);
 const fee=safePurchase?preview.feeCents:0,shipping=fulfillment==='pickup'?0:shippingCents;
 const mounted=useRef(true),generation=useRef(0),inFlight=useRef(false),intent=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{mounted.current=true;generation.current++;intent.current=null;setError('');setBusy(false);setPayment(null);return()=>{mounted.current=false;generation.current++}},[listingId]);
 // Store credit is kept per payment mode: test orders spend sandbox credit, live orders spend live credit.
 const live=data?.sandbox===false,walletMode=live?'live':'sandbox';
 useEffect(()=>{const abort=new AbortController();void fetch('/api/wallet?mode='+walletMode,{signal:abort.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('Wallet unavailable');return response.json()}).then(body=>{const cents=body?.rewards?.balances?.[walletMode]?.availableCreditCents;if(!abort.signal.aborted)setCreditBalance(Number.isSafeInteger(cents)?cents:null)}).catch(()=>{});return()=>abort.abort()},[listingId,walletMode]);
 const available=!!data?.setup.checkoutEnabled&&!setupError&&!requiresInspection;
 async function checkout(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current||!available)return;
  const token=generation.current,form=new FormData(event.currentTarget),shippingAddress=fulfillment==='pickup'?undefined:{name:String(form.get('name')||'').trim(),line1:String(form.get('line1')||'').trim(),line2:String(form.get('line2')||'').trim(),city:String(form.get('city')||'').trim(),state:String(form.get('state')||'').toUpperCase().trim(),postalCode:String(form.get('postalCode')||'').trim(),country:'US'};
  const storeCreditCents=Math.round(Number(credit)*100);if(!Number.isSafeInteger(storeCreditCents)||storeCreditCents<0||storeCreditCents>(creditBalance??0)){setError('Choose an amount within your available store credit.');return}
  const options={fulfillment,safePurchaseOptIn:buyerSafePurchase&&preview.enabled,waiveSafePurchase:fulfillment==='pickup'&&waive};
  const checkoutUiMode=data?.paymentElementEnabled?'elements':'hosted_page';const key=JSON.stringify({listingId,shippingAddress,storeCreditCents,checkoutUiMode,...options});if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
  inFlight.current=true;setBusy(true);setError('');
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),25000);
  try{
   const response=await fetch('/api/commerce',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'checkout',listingId,requestId:intent.current.id,sandboxAcknowledged:form.get('sandbox')==='on',...(shippingAddress?{shippingAddress}:{}),storeCreditCents,checkoutUiMode,...options}),signal:abort.signal});
   const result=await response.json() as {error?:string;checkoutUrl?:string;clientSecret?:string;publishableKey?:string;order?:{id:string;createdAt?:string}};if(!response.ok)throw Error(result.error||'Checkout could not start. Please retry.');
   if(!mounted.current||token!==generation.current)return;
   // Checkout holds the listing for this buyer for an hour after the order is created.
   if(result.order?.createdAt&&Number.isFinite(Date.parse(result.order.createdAt)))setReservedUntil(Date.parse(result.order.createdAt)+3600000);
   // The publishable key and session must both belong to the deployment's payment mode.
   const keyMode=live?'live':'test';
   if(result.clientSecret&&result.publishableKey&&result.order?.id){if(!new RegExp('^pk_'+keyMode+'_[A-Za-z0-9]{16,}$').test(result.publishableKey)||!result.clientSecret.startsWith('cs_'+keyMode+'_'))throw Error('The embedded payment response could not be verified.');setPayment({clientSecret:result.clientSecret,publishableKey:result.publishableKey,orderId:result.order.id});onNotice(live?'Secure payment is ready.':'Secure test payment is ready.');return}
   const url=paymentUrl(result.checkoutUrl);onNotice(live?'Opening secure Stripe checkout.':'Opening secure Stripe test checkout. Use test payment details only.');window.location.assign(url);
  }catch(problem){if(mounted.current&&token===generation.current)setError(abort.signal.aborted?'Checkout confirmation timed out. Open Orders before trying another payment; your saved request will be reused.':problem instanceof Error?problem.message:'Checkout could not be confirmed. Check Orders before retrying.')}
  finally{clearTimeout(timeout);inFlight.current=false;if(mounted.current&&token===generation.current)setBusy(false)}
 }
 return <div className="marketplace-checkout">
  <h4>Payment</h4><div className="checkout-payments" aria-label="Processor-supported payment methods"><span><CreditCard size={16}/> Credit / debit card</span><span>Apple Pay</span><span>Google Pay</span></div>
  <p className="data-caption">Stripe provides the secure payment form. Apple Pay and Google Pay appear only on eligible devices and registered payment domains.</p>
  {(loading||setupError||!data?.setup.checkoutEnabled||requiresInspection)&&<div className="checkout-status" role={setupError?'alert':'status'}>
   <strong>{requiresInspection?'SafePurchase inspection comes first':setupError?'Payment check unavailable':loading?'Checking payment availability…':'Checkout is temporarily unavailable'}</strong>
   <p>{requiresInspection?'The seller offers SafePurchase inspection for this listing. Agree on the inspection and service terms with the seller before anyone pays or ships.':setupError||(!loading?'Online payment isn’t available right now, and nothing has been charged. You can still message the seller, make an offer or arrange local pickup, and try again later.':'Your purchase summary and seller contact remain available.')}</p>
   {requiresInspection&&onInspectionRequest?<button type="button" className="inline-button" onClick={onInspectionRequest}><ShieldCheck size={15}/> Request SafePurchase inspection</button>:<button type="button" className="inline-button" disabled={loading} onClick={()=>void reload()}><RefreshCw size={15}/> {loading?'Checking…':'Retry payment check'}</button>}
  </div>}
  {itemCents>0&&<div className={'checkout-protection'+(safePurchase?' is-safepurchase':'')}>
   {safePurchase?<><strong><ShieldCheck size={16}/> SafePurchase{preview.automatic?' applies to this order':' added'}</strong><p>{fulfillment==='pickup'?'You pick up at the ComicHuddle Inspection Center after the comic passes inspection, using your 6-digit pickup code.':'Independent inspection before the comic reaches you.'}</p>{fulfillment==='shipping'&&<SafePurchaseSteps fee={fee}/>}</>
   :preview.comingSoon&&!waive?<><strong><ShieldCheck size={16}/> Standard Protection · SafePurchase inspection coming soon</strong><p>Inspection isn’t available yet, so this order is not inspected. {preview.over&&fulfillment==='shipping'?'Because it is over '+usd(preview.threshold)+', the seller must ship insured with signature required, and ':''}the seller is paid {preview.standardHold} hours after confirmed delivery if you don’t report a problem.</p></>
   :<><strong><ShieldCheck size={16}/> Standard Protection</strong><p>Money back if it doesn’t arrive or isn’t as described. {fulfillment==='pickup'?'You get a 6-digit pickup code; the order completes when you confirm the hand-off.':'The seller ships with tracking within '+preview.handlingDays+' business days.'} You can report a problem for {preview.claimDays} days after delivery.</p></>}
   {preview.enabled&&!preview.over&&!sellerSafePurchase&&<label className="check-label"><input type="checkbox" checked={buyerSafePurchase} onChange={event=>setBuyerSafePurchase(event.target.checked)}/><span>Add SafePurchase inspection{preview.feeCents?' ('+usd(preview.feeCents)+')':''}</span></label>}
   {preview.enabled&&(preview.over||sellerSafePurchase)&&fulfillment==='pickup'&&<label className="check-label"><input type="checkbox" checked={waive} onChange={event=>setWaive(event.target.checked)}/><span>Waive SafePurchase and pick up directly from the seller. I understand this order will not be inspected and gets Standard Protection only.</span></label>}
  </div>}
  {reservedUntil!==null&&reservedUntil>clock&&<p className="mp-reserved" role="status">Reserved for you for {Math.max(1,Math.ceil((reservedUntil-clock)/60000))} more minutes. Nobody else can buy it while you pay.</p>}
  {payment?<StripePaymentElement key={payment.orderId} {...payment}/>:<details className="checkout-address" open={available}><summary>{fulfillment==='pickup'?'Local pickup':'Delivery address · USA shipping'}</summary>
   <form className="sandbox-checkout" onSubmit={event=>void checkout(event)}>
    {fulfillmentOptions.length>1&&<fieldset className="checkout-fulfillment"><legend>How do you want it?</legend>{fulfillmentOptions.map(option=><label key={option} className="check-label"><input type="radio" name="fulfillment" value={option} checked={fulfillment===option} onChange={()=>setFulfillment(option)}/><span>{option==='shipping'?'Ship it to me':'Local pickup (no shipping charge)'}</span></label>)}</fieldset>}
    {fulfillment==='shipping'?<><p className="data-caption">Fields marked <span className="required-mark">*</span> are required.</p>
    <label><span>Recipient name <span className="required-mark" aria-hidden="true">*</span></span><input name="name" autoComplete="shipping name" required maxLength={100}/></label>
    <label><span>Street address <span className="required-mark" aria-hidden="true">*</span></span><input name="line1" autoComplete="shipping address-line1" required maxLength={160}/></label>
    <label>Apartment / unit (optional)<input name="line2" autoComplete="shipping address-line2" maxLength={100}/></label>
    <div className="form-grid"><label><span>City <span className="required-mark" aria-hidden="true">*</span></span><input name="city" autoComplete="shipping address-level2" required maxLength={80}/></label><label><span>State <span className="required-mark" aria-hidden="true">*</span></span><input name="state" autoComplete="shipping address-level1" required pattern="[A-Za-z]{2}" maxLength={2}/></label><label><span>ZIP code <span className="required-mark" aria-hidden="true">*</span></span><input name="postalCode" autoComplete="shipping postal-code" inputMode="numeric" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10}/></label></div></>
    :<p className="data-caption">After payment your order shows a 6-digit pickup code. Meet in a safe public place; give the seller the code (or tap “I picked it up”) only once you have the comic.</p>}
    {itemCents>0&&<p className="checkout-total">Total before credit: <strong>{usd(itemCents+shipping+fee)}</strong>{shipping?' · includes '+usd(shipping)+' shipping':''}{fee?' · includes '+usd(fee)+' inspection fee':''}</p>}
    <label>Apply store credit (USD)<input type="number" min="0" max={(creditBalance??0)/100} step="0.01" value={credit} onChange={event=>setCredit(event.target.value)} disabled={!creditBalance}/><small>{creditBalance===null?'Store credit unavailable; you can pay directly by card.':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(creditBalance/100)+(live?' credit available':' test credit available')} · item subtotal only · no cash-outs</small></label>
    {itemCents>0&&(()=>{const raw=Number(credit),cents=Number.isFinite(raw)?Math.round(raw*100):NaN,gross=itemCents+shipping+fee;if(!Number.isSafeInteger(cents)||cents<0)return <p className="checkout-live-total network-error" role="status">Enter a valid credit amount.</p>;if(cents>(creditBalance??0))return <p className="checkout-live-total network-error" role="status">That’s more than your available credit.</p>;if(cents>itemCents)return <p className="checkout-live-total network-error" role="status">Credit can cover the item price only, not shipping or fees.</p>;if(gross-cents<50)return <p className="checkout-live-total network-error" role="status">At least $0.50 must be paid by card.</p>;return <p className="checkout-live-total" role="status" aria-live="polite">You’ll pay <strong>{usd(gross-cents)}</strong>{cents>0?' · '+usd(cents)+' credit applied':''}</p>})()}
    <label className="check-label"><input name="sandbox" type="checkbox" required/><span>{live?(fulfillment==='pickup'?'I confirm this purchase for local pickup. My card is charged by Stripe.':'I confirm this purchase and the shipping address above. My card is charged by Stripe.'):'I understand this is a test checkout. I will use Stripe test card details, and no real money will be charged.'} <span className="required-mark" aria-hidden="true">*</span></span></label>
    {error&&<p className="network-error" role="alert">{error} <a href="/?section=Account&accountTab=Orders">View Orders</a></p>}
    <button className="button red checkout-submit" disabled={busy||!available}>{busy?'Opening checkout…':live?'Continue to secure payment':'Continue to secure test payment'}<ArrowUpRight size={16}/></button>
   </form>
  </details>}
  <p className="checkout-security"><LockKeyhole size={13}/> ComicHuddle does not collect or store card numbers. A checkout redirect alone never confirms payment.</p>
 </div>;
}
