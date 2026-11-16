'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
const StripePaymentElement=dynamic(()=>import('./stripe-payment-element'),{ssr:false,loading:()=> <p role="status">Loading secure payment form…</p>});
import {ArrowUpRight,CreditCard,LockKeyhole,RefreshCw,ShieldCheck} from 'lucide-react';
import {HuddlesArt} from '../components/huddles-guide';
import './commerce-fees.css';
import './marketplace-redesign.css';

export type CheckoutSetup={enabled:boolean;ready:boolean;checkoutEnabled:boolean;reason:string};
export type ProtectionSettings={safePurchaseEnabled:boolean;safePurchaseThresholdCents:number;safePurchaseFeeCents:number;safePurchaseReleaseHoldHours:number;standardReleaseHoldHours:number;handlingBusinessDays:number;claimDays:number};
export type PaymentConfiguration={publishableKey?:string|null;paymentElementEnabled?:boolean;setup:CheckoutSetup;sandbox:boolean;mode?:'test'|'live';carrierConnected:boolean;payoutsEnabled:boolean;productionPaymentsEnabled:boolean;protection?:ProtectionSettings};
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
/** Which protection an order of this value gets, before payment. Mirrors lib/commerce-protection.ts. */
export function protectionPreview(settings:ProtectionSettings|undefined,itemCents:number,sellerOptIn:boolean){
 const threshold=settings?.safePurchaseThresholdCents??50000,over=itemCents>=threshold,enabled=!!settings?.safePurchaseEnabled;
 return {over,enabled,threshold,automatic:over&&enabled,offered:enabled&&(over||sellerOptIn),comingSoon:!enabled&&(over||sellerOptIn),feeCents:settings?.safePurchaseFeeCents??0,spHold:settings?.safePurchaseReleaseHoldHours??48,standardHold:settings?.standardReleaseHoldHours??72,handlingDays:settings?.handlingBusinessDays??3,claimDays:settings?.claimDays??30};
}
/** The three SafePurchase steps. Only render this when SafePurchase is live. */
export function SafePurchaseSteps({fee}:{fee:number}){return <div className="mpx-sp-steps"><ol className="safepurchase-steps"><li><b>1</b><span>You buy</span></li><li><b>2</b><span>We check the book</span></li><li><b>3</b><span>It ships to you</span></li></ol><p>You have 48 hours after delivery to report a problem.</p>{fee>0&&<p>SafePurchase fee: {usd(fee)}. It&rsquo;s in your total.</p>}</div>}

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
type Rate={id:string;carrier:string;service:string;cents:number;days:number|null};
type CheckoutProps={listingId:string;onNotice:(text:string)=>void;requiresInspection?:boolean;onInspectionRequest?:()=>void;fulfillmentOptions?:('shipping'|'pickup')[];itemCents?:number;shippingCents?:number;shippingCalculated?:boolean;sellerSafePurchase?:boolean};
export default function MarketplaceCheckout({listingId,onNotice,requiresInspection=false,onInspectionRequest,fulfillmentOptions=['shipping'],itemCents=0,shippingCents=0,shippingCalculated=false,sellerSafePurchase=false}:CheckoutProps){
 const {data,error:setupError,loading,reload}=usePaymentConfiguration();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[credit,setCredit]=useState('0'),[creditBalance,setCreditBalance]=useState<number|null>(null),[payment,setPayment]=useState<{clientSecret:string;publishableKey:string;orderId:string}|null>(null);
 const [reservedUntil,setReservedUntil]=useState<number|null>(null),[clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{if(reservedUntil===null)return;const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[reservedUntil]);
 const [fulfillment,setFulfillment]=useState<'shipping'|'pickup'>(fulfillmentOptions[0]||'shipping'),[buyerSafePurchase,setBuyerSafePurchase]=useState(false),[waive,setWaive]=useState(false);
 const preview=protectionPreview(data?.protection,itemCents,sellerSafePurchase),safePurchase=preview.enabled&&(preview.over||sellerSafePurchase||buyerSafePurchase)&&!(fulfillment==='pickup'&&waive);
 // Calculated shipping: live carrier rates for the buyer's ZIP. The server re-quotes at checkout and charges that.
 const [rates,setRates]=useState<{zip:string;options:Rate[];packageLabel:string}|null>(null),[rateId,setRateId]=useState(''),[rateState,setRateState]=useState('');
 const quoteSeq=useRef(0);
 async function quote(zip:string){
  if(!shippingCalculated||!/^\d{5}$/.test(zip)||rates?.zip===zip)return;
  const seq=++quoteSeq.current;setRateState('Getting live shipping rates…');
  try{
   const response=await fetch('/api/shipping/quote?'+new URLSearchParams({listingId,zip}),{credentials:'same-origin',cache:'no-store'}),body=await response.json().catch(()=>({}));
   if(seq!==quoteSeq.current)return;
   if(!response.ok)throw Error(typeof body.error==='string'?body.error:'Shipping rates couldn’t be loaded.');
   const options=(Array.isArray(body.options)?body.options:[]) as Rate[];
   setRates({zip,options,packageLabel:typeof body.package==='string'?body.package:''});setRateId(options[0]?.id||'');setRateState('');
  }catch(problem){if(seq===quoteSeq.current){setRates(null);setRateId('');setRateState(problem instanceof Error?problem.message:'Shipping rates couldn’t be loaded.')}}
 }
 const chosenRate=rates?.options.find(option=>option.id===rateId)||null,needsRate=shippingCalculated&&fulfillment==='shipping'&&!chosenRate;
 const fee=safePurchase?preview.feeCents:0,shipping=fulfillment==='pickup'?0:shippingCalculated?chosenRate?.cents??0:shippingCents;
 const mounted=useRef(true),generation=useRef(0),inFlight=useRef(false),intent=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{mounted.current=true;generation.current++;intent.current=null;setError('');setBusy(false);setPayment(null);return()=>{mounted.current=false;generation.current++}},[listingId]);
 // Store credit is kept per payment mode: test orders spend sandbox credit, live orders spend live credit.
 const live=data?.sandbox===false,walletMode=live?'live':'sandbox';
 useEffect(()=>{const abort=new AbortController();void fetch('/api/wallet?mode='+walletMode,{signal:abort.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('Wallet unavailable');return response.json()}).then(body=>{const cents=body?.rewards?.balances?.[walletMode]?.availableCreditCents;if(!abort.signal.aborted)setCreditBalance(Number.isSafeInteger(cents)?cents:null)}).catch(()=>{});return()=>abort.abort()},[listingId,walletMode]);
 const available=!!data?.setup.checkoutEnabled&&!setupError&&!requiresInspection;
 async function checkout(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current||!available)return;
  const token=generation.current,form=new FormData(event.currentTarget),shippingAddress=fulfillment==='pickup'?undefined:{name:String(form.get('name')||'').trim(),line1:String(form.get('line1')||'').trim(),line2:String(form.get('line2')||'').trim(),city:String(form.get('city')||'').trim(),state:String(form.get('state')||'').toUpperCase().trim(),postalCode:String(form.get('postalCode')||'').trim(),country:'US'};
  const storeCreditCents=Math.round(Number(credit)*100);if(!Number.isSafeInteger(storeCreditCents)||storeCreditCents<0||storeCreditCents>(creditBalance??0)){setError('That’s more store credit than you have.');return}
  const options={fulfillment,safePurchaseOptIn:buyerSafePurchase&&preview.enabled,waiveSafePurchase:fulfillment==='pickup'&&waive};
  const checkoutUiMode=data?.paymentElementEnabled?'elements':'hosted_page';const key=JSON.stringify({listingId,shippingAddress,storeCreditCents,checkoutUiMode,...options});if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
  inFlight.current=true;setBusy(true);setError('');
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),25000);
  try{
   const response=await fetch('/api/commerce',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'checkout',listingId,requestId:intent.current.id,sandboxAcknowledged:form.get('sandbox')==='on',...(shippingAddress?{shippingAddress}:{}),...(shippingCalculated&&chosenRate?{shippingService:chosenRate.id}:{}),storeCreditCents,checkoutUiMode,...options}),signal:abort.signal});
   const result=await response.json() as {error?:string;checkoutUrl?:string;clientSecret?:string;publishableKey?:string;order?:{id:string;createdAt?:string}};if(!response.ok)throw Error(result.error||'Checkout could not start. Please retry.');
   if(!mounted.current||token!==generation.current)return;
   // Checkout holds the listing for this buyer for an hour after the order is created.
   if(result.order?.createdAt&&Number.isFinite(Date.parse(result.order.createdAt)))setReservedUntil(Date.parse(result.order.createdAt)+3600000);
   // The publishable key and session must both belong to the deployment's payment mode.
   const keyMode=live?'live':'test';
   if(result.clientSecret&&result.publishableKey&&result.order?.id){if(!new RegExp('^pk_'+keyMode+'_[A-Za-z0-9]{16,}$').test(result.publishableKey)||!result.clientSecret.startsWith('cs_'+keyMode+'_'))throw Error('The embedded payment response could not be verified.');setPayment({clientSecret:result.clientSecret,publishableKey:result.publishableKey,orderId:result.order.id});onNotice(live?'Secure payment is ready.':'Secure test payment is ready.');return}
   const url=paymentUrl(result.checkoutUrl);onNotice(live?'Opening secure Stripe checkout.':'Opening secure Stripe test checkout. Use test payment details only.');window.location.assign(url);
  }catch(problem){if(mounted.current&&token===generation.current)setError(abort.signal.aborted?'Checkout timed out. Check Orders before you try again.':problem instanceof Error?problem.message:'Couldn’t start checkout. Check Orders, then try again.')}
  finally{clearTimeout(timeout);inFlight.current=false;if(mounted.current&&token===generation.current)setBusy(false)}
 }
 const gross=itemCents+shipping+fee,rawCredit=Number(credit),creditCents=Number.isFinite(rawCredit)?Math.round(rawCredit*100):NaN;
 const creditProblem=!Number.isSafeInteger(creditCents)||creditCents<0?'Enter a valid credit amount.':creditCents>(creditBalance??0)?'That’s more than your available credit.':creditCents>itemCents?'Credit covers the comic only, not shipping or fees.':gross-creditCents<50?'At least $0.50 has to go on a card.':'';
 const inspectionReady=requiresInspection&&preview.enabled;
 return <div className="marketplace-checkout mpx-pay">
  <div className="mpx-pay-head"><h4>Payment</h4><div className="checkout-payments mpx-pay-methods" aria-label="Payment methods"><span><CreditCard size={16}/> Credit / debit card</span><span>Apple Pay</span><span>Google Pay</span></div></div>
  <p className="mpx-fine">Stripe runs the payment form. Apple Pay and Google Pay show up on supported devices.</p>
  {(loading||setupError||!data?.setup.checkoutEnabled||requiresInspection)&&<div className="checkout-status mpx-pay-status" role={setupError?'alert':'status'}>
   <strong>{requiresInspection?(inspectionReady?'Add SafePurchase first':'This sale can’t be paid online yet'):setupError?'Payment check unavailable':loading?'Checking payments…':'Checkout is unavailable right now'}</strong>
   <p>{requiresInspection?(inspectionReady?'The seller asked for SafePurchase on this sale. Add it before anyone pays or ships.':'The seller asked for SafePurchase, and it isn’t available yet. Message the seller to sort it out.'):setupError||(!loading?'Nothing was charged. You can still message the seller, make an offer or meet up locally.':'Your order summary and seller chat are still here.')}</p>
   {inspectionReady&&onInspectionRequest?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onInspectionRequest}><ShieldCheck size={15}/> Add SafePurchase</button>:<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={loading} onClick={()=>void reload()}><RefreshCw size={15}/> {loading?'Checking…':'Retry payment check'}</button>}
  </div>}
  {itemCents>0&&<div className={'checkout-protection mpx-protect'+(safePurchase?' is-safepurchase':'')}>
   {safePurchase?<><strong className="mpx-sp-title"><HuddlesArt pose="safepurchase" size="sm" decorative className="mpx-shield"/> SafePurchase{preview.automatic?' is on for this order':' added'}</strong><p>{fulfillment==='pickup'?'Pick it up at our inspection center with your 6-digit code once it passes.':'We check the book before it ships to you.'}</p>{fulfillment==='shipping'&&<SafePurchaseSteps fee={fee}/>}</>
   :<><strong><ShieldCheck size={16}/> Standard Protection</strong><p>Money back if it doesn’t arrive or isn’t as described. {fulfillment==='pickup'?'You get a 6-digit PIN and a QR code. Give it to the seller once you have the comic. Your payment is held until pickup.':(preview.over?'It ships insured with a signature. ':'')+'The seller ships with tracking within '+preview.handlingDays+' business days.'} You can report a problem for {preview.claimDays} days after delivery.</p></>}
   {preview.enabled&&!preview.over&&!sellerSafePurchase&&<label className="check-label mpx-check"><input type="checkbox" checked={buyerSafePurchase} onChange={event=>setBuyerSafePurchase(event.target.checked)}/><span><HuddlesArt pose="safepurchase" size="sm" decorative className="mpx-shield"/> Add SafePurchase{preview.feeCents?' ('+usd(preview.feeCents)+')':''}</span></label>}
   {preview.enabled&&(preview.over||sellerSafePurchase)&&fulfillment==='pickup'&&<label className="check-label mpx-check"><input type="checkbox" checked={waive} onChange={event=>setWaive(event.target.checked)}/><span>Skip SafePurchase and pick up from the seller. It won’t be inspected.</span></label>}
  </div>}
  {reservedUntil!==null&&reservedUntil>clock&&<p className="mp-reserved" role="status">Held for you for {Math.max(1,Math.ceil((reservedUntil-clock)/60000))} more minutes. Nobody else can buy it while you pay.</p>}
  {payment?<StripePaymentElement key={payment.orderId} {...payment}/>:<details className="checkout-address mpx-address" open={available}><summary>{fulfillment==='pickup'?'Local pickup':'Shipping address'}</summary>
   <form className="sandbox-checkout mpx-pay-form" onSubmit={event=>void checkout(event)}>
    {fulfillmentOptions.length>1&&<fieldset className="checkout-fulfillment mpx-fulfillment"><legend>How do you want it?</legend>{fulfillmentOptions.map(option=><label key={option} className="check-label mpx-radio"><input type="radio" name="fulfillment" value={option} checked={fulfillment===option} onChange={()=>setFulfillment(option)}/><span>{option==='shipping'?'Ship it to me':'Local pickup (free)'}</span></label>)}</fieldset>}
    {fulfillment==='shipping'?<><p className="mpx-fine">Fields with <span className="required-mark">*</span> are required.</p>
    <label className="ds-field"><span>Recipient name <span className="required-mark" aria-hidden="true">*</span></span><input name="name" autoComplete="shipping name" required maxLength={100}/></label>
    <label className="ds-field"><span>Street address <span className="required-mark" aria-hidden="true">*</span></span><input name="line1" autoComplete="shipping address-line1" required maxLength={160}/></label>
    <label className="ds-field"><span>Apt or unit (optional)</span><input name="line2" autoComplete="shipping address-line2" maxLength={100}/></label>
    <div className="mpx-address-grid"><label className="ds-field"><span>City <span className="required-mark" aria-hidden="true">*</span></span><input name="city" autoComplete="shipping address-level2" required maxLength={80}/></label><label className="ds-field"><span>State <span className="required-mark" aria-hidden="true">*</span></span><input name="state" autoComplete="shipping address-level1" required pattern="[A-Za-z]{2}" maxLength={2}/></label><label className="ds-field"><span>ZIP code <span className="required-mark" aria-hidden="true">*</span></span><input name="postalCode" autoComplete="shipping postal-code" inputMode="numeric" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} onChange={event=>void quote(event.target.value.trim().slice(0,5))}/></label></div>
    {shippingCalculated&&<fieldset className="mpx-rates"><legend>Shipping service</legend>
     {rates?<>{rates.options.map(option=><label key={option.id} className="check-label mpx-radio mpx-rate"><input type="radio" name="shippingService" value={option.id} checked={rateId===option.id} onChange={()=>setRateId(option.id)}/><span><strong>{option.carrier} {option.service}</strong><small>{option.days?option.days+' business day'+(option.days===1?'':'s'):'Delivery time varies'}</small></span><b>{usd(option.cents)}</b></label>)}
      <small className="mpx-fine">Live carrier rates for {rates.packageLabel?rates.packageLabel.toLowerCase():'this package'} to {rates.zip}.</small></>
     :<p className="mpx-fine" role="status">{rateState||'Enter your ZIP code to see shipping options.'}</p>}
    </fieldset>}</>
    :<p className="mpx-fine">After you pay, you get a 6-digit PIN and a QR code in your order. Meet somewhere public. Share the PIN only once the comic is in your hands. If it isn’t used within 7 days, you’re refunded in full.</p>}
    <label className="ds-field"><span>Use store credit (USD)</span><input type="number" min="0" max={(creditBalance??0)/100} step="0.01" value={credit} onChange={event=>setCredit(event.target.value)} disabled={!creditBalance}/><small>{creditBalance===null?'No store credit to use. You can pay by card.':usd(creditBalance)+(live?' available':' test credit available')+'. Covers the comic, not shipping or fees.'}</small></label>
    {itemCents>0&&<><dl className="mpx-receipt" aria-label="Order total"><div><dt>Comic</dt><dd>{usd(itemCents)}</dd></div><div><dt>{fulfillment==='pickup'?'Local pickup':'Shipping'}</dt><dd>{needsRate?'Enter ZIP':shipping?usd(shipping):'Free'}</dd></div>{fee>0&&<div><dt>SafePurchase</dt><dd>{usd(fee)}</dd></div>}{!creditProblem&&creditCents>0&&<div><dt>Store credit</dt><dd>&minus;{usd(creditCents)}</dd></div>}<div className="mpx-receipt-total"><dt>You pay</dt><dd className="checkout-live-total" role="status" aria-live="polite">{usd(creditProblem?gross:gross-creditCents)}</dd></div></dl>
     {creditProblem&&<p className="ds-error" role="status">{creditProblem}</p>}<p className="mpx-fine">Any sales tax is added on the payment screen.</p></>}
    <label className="check-label mpx-check"><input name="sandbox" type="checkbox" required/><span>{live?(fulfillment==='pickup'?'I confirm this purchase for local pickup. Stripe charges my card.':'I confirm this purchase and address. Stripe charges my card.'):'This is a test checkout. I’ll use a Stripe test card. No real money moves.'} <span className="required-mark" aria-hidden="true">*</span></span></label>
    {error&&<p className="ds-error" role="alert">{error} <a className="ds-link" href="/?section=Account&accountTab=Orders">View Orders</a></p>}
    <button className="ds-btn ds-btn-primary checkout-submit" disabled={busy||!available||needsRate}>{busy?'Opening checkout…':live?'Continue to secure payment':'Continue to secure test payment'}<ArrowUpRight size={16}/></button>
   </form>
  </details>}
  <p className="checkout-security mpx-fine"><LockKeyhole size={14}/> We never see or store your card number.</p>
 </div>;
}
