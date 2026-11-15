'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {AlertTriangle,ArrowUpRight,Bookmark,Clock,LockKeyhole,ShieldCheck,ShoppingCart,Trash2,Undo2} from 'lucide-react';
import ResolvedComicCover from '../resolved-comic-cover';
import {usePaymentConfiguration} from '../marketplace-checkout';
import {accountLinks} from '../../components/account-prompt';
import {notifyCartChanged,readGuestCart,removeFromGuestCart} from '../../components/cart/cart-store';
import type {CartHold,CartItemView} from '../../lib/cart';

type CartData={signedIn:true;items:CartItemView[];holds:CartHold[];safePurchase:{enabled:boolean;feeCents:number};taxCalculated:boolean;limits:{maxItems:number;maxCheckoutItems:number}};
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const statusLabel:Record<CartItemView['status'],string>={available:'',held_by_you:'Held for you',reserved:'Someone is checking out',sold:'Sold',unavailable:'No longer available'};

function paymentUrl(value:unknown){
 if(typeof value!=='string')return null;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='checkout.stripe.com'&&!url.username&&!url.password&&!url.port?url.href:null}catch{return null}
}
async function post(path:string,body:Record<string,unknown>){
 const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json().catch(()=>({})) as Record<string,unknown>&{error?:string};
 if(!response.ok)throw Object.assign(Error(result.error||'That didn’t work. Please try again.'),{status:response.status});
 return result;
}

function GuestCart(){
 // Rendered only on the client, after the cart request says the visitor is a guest.
 const [count]=useState(()=>readGuestCart().length);
 const links=accountLinks();
 return <section className="cart-empty ds-card">
  <ShoppingCart size={34} aria-hidden/>
  <h2>Sign in to see your cart</h2>
  <p>{count?`You have ${count} ${count===1?'comic':'comics'} saved on this device. Sign in and they move into your account cart.`:'Your cart lives in your free ComicHuddle account, so it follows you to any device.'}</p>
  <div className="cart-actions"><a className="ds-btn ds-btn-primary" href={links.signIn}>Sign in</a><a className="ds-btn ds-btn-secondary" href={links.join}>Create a free account</a></div>
 </section>;
}

function ItemRow({item,busy,onAction}:{item:CartItemView;busy:boolean;onAction:(action:string,item:CartItemView)=>void}){
 const flag=item.status!=='available'?statusLabel[item.status]:item.pickupOnly?'Local pickup only':'';
 return <li className={'cart-item'+(item.checkoutReady?'':' is-flagged')}>
  <a className="cart-cover" href={item.href} aria-label={'Open listing: '+item.title}><ResolvedComicCover src={item.photo} title={item.title} actualPhoto/></a>
  <div className="cart-item-body">
   <a className="cart-item-title" href={item.href}>{item.title}{item.issue&&!item.title.includes(item.issue.replace(/^#/,''))&&<span> #{item.issue.replace(/^#/,'')}</span>}</a>
   <p className="cart-item-meta">{item.kind==='collection'?<span>{item.itemCount}-comic set</span>:item.condition?<span>{item.condition}</span>:<span>Condition not listed</span>}{item.seller.name&&<span>Sold by {item.seller.name}</span>}</p>
   {flag&&<p className="cart-flag" role="status"><AlertTriangle size={14} aria-hidden/> <strong>{flag}.</strong> {item.problem}</p>}
   {item.priceChanged&&item.status==='available'&&<p className="cart-flag is-info" role="status">Price changed from {usd(item.addedPriceCents)} to {usd(item.priceCents)}.</p>}
   <div className="cart-item-actions">
    {item.savedForLater
     ?<button type="button" className="ds-link" disabled={busy} onClick={()=>onAction('move_to_cart',item)}><Undo2 size={14} aria-hidden/> Move to cart</button>
     :<button type="button" className="ds-link" disabled={busy} onClick={()=>onAction('save_for_later',item)}><Bookmark size={14} aria-hidden/> Save for later</button>}
    <button type="button" className="ds-link cart-remove" disabled={busy} onClick={()=>onAction('remove',item)}><Trash2 size={14} aria-hidden/> Remove</button>
   </div>
  </div>
  <div className="cart-item-price">{item.status==='sold'||item.status==='unavailable'?<s>{usd(item.priceCents)}</s>:<strong>{usd(item.priceCents)}</strong>}</div>
 </li>;
}

function Holds({holds,live,onChanged}:{holds:CartHold[];live:boolean;onChanged:()=>void}){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[]);
 async function pay(hold:CartHold){
  setBusy(hold.orderId);setError('');
  try{const result=await post('/api/commerce',{action:'resume_payment',orderId:hold.orderId}),url=paymentUrl(result.checkoutUrl);if(!url)throw Error('This payment can’t be opened from the cart. Open it from Orders.');window.location.assign(url)}
  catch(problem){setError(problem instanceof Error?problem.message:'Couldn’t open the payment.');setBusy('');onChanged()}
 }
 async function release(hold:CartHold){
  if(!window.confirm('Release “'+hold.title+'”? Anyone can buy it again.'))return;
  setBusy(hold.orderId);setError('');
  try{await post('/api/commerce',{action:'cancel_checkout',orderId:hold.orderId});notifyCartChanged()}
  catch(problem){setError(problem instanceof Error?problem.message:'Couldn’t release it.')}
  finally{setBusy('');onChanged()}
 }
 const total=holds.reduce((sum,hold)=>sum+hold.totalCents,0);
 return <section className="cart-holds ds-card" aria-labelledby="cart-holds-title">
  <h2 id="cart-holds-title"><Clock size={18} aria-hidden/> Pay for your held comics</h2>
  <p>Nobody else can buy these while they’re held. Each one is a separate secure payment{live?'':' (test mode: use a Stripe test card)'}. After each payment you land in Orders. Come back here to pay the next one.</p>
  <ol className="cart-steps">{holds.map((hold,index)=>{const left=hold.reservedUntil?Math.max(0,Math.ceil((Date.parse(hold.reservedUntil)-clock)/60000)):null;return <li key={hold.orderId}>
   <span className="cart-step-no">{index+1}</span>
   <span className="cart-step-text"><strong>{hold.title}</strong><small>{usd(hold.totalCents)}{left!==null?` · held ${left} more ${left===1?'minute':'minutes'}`:''}</small></span>
   <span className="cart-step-actions"><button type="button" className="ds-btn ds-btn-primary ds-btn-sm" disabled={!!busy} onClick={()=>void pay(hold)}>{busy===hold.orderId?'Opening…':'Pay '+usd(hold.totalCents)}<ArrowUpRight size={15} aria-hidden/></button><button type="button" className="ds-link" disabled={!!busy} onClick={()=>void release(hold)}>Release</button></span>
  </li>})}</ol>
  {holds.length>1&&<p className="cart-fine">Total for held comics: <strong>{usd(total)}</strong></p>}
  {error&&<p className="ds-error" role="alert">{error} <Link className="ds-link" href="/?section=Account&accountTab=Orders">View Orders</Link></p>}
 </section>;
}

export default function CartView(){
 const [data,setData]=useState<CartData|null>(null),[guest,setGuest]=useState(false),[loadError,setLoadError]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[actionError,setActionError]=useState('');
 const [checkingOut,setCheckingOut]=useState(false),[submitting,setSubmitting]=useState(false),[checkoutError,setCheckoutError]=useState(''),[safePurchaseOptIn,setSafePurchaseOptIn]=useState(false);
 const intent=useRef<{key:string;id:string}|null>(null),inFlight=useRef(false);
 const payments=usePaymentConfiguration(),live=payments.data?.sandbox===false,checkoutEnabled=!!payments.data?.setup.checkoutEnabled&&!payments.error;
 const load=useCallback(async()=>{
  try{const response=await fetch('/api/cart',{credentials:'same-origin',cache:'no-store'}),body=await response.json().catch(()=>({})) as Record<string,unknown>;
   if(!response.ok)throw Error(typeof body.error==='string'?body.error:'Your cart couldn’t load.');
   if(body.signedIn===false){setGuest(true);return}
   setGuest(false);setData(body as unknown as CartData);setLoadError('');
  }catch(problem){setLoadError(problem instanceof Error?problem.message:'Your cart couldn’t load.')}
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer)},[load]);

 const active=useMemo(()=>data?.items.filter(item=>!item.savedForLater)??[],[data]);
 const saved=useMemo(()=>data?.items.filter(item=>item.savedForLater)??[],[data]);
 const groups=useMemo(()=>{const map=new Map<string,{seller:CartItemView['seller'];items:CartItemView[]}>();for(const item of active){const key=item.seller.id||'removed';if(!map.has(key))map.set(key,{seller:item.seller,items:[]});map.get(key)!.items.push(item)}return [...map.values()]},[active]);
 const ready=active.filter(item=>item.checkoutReady);
 const spEnabled=!!data?.safePurchase.enabled,spFee=data?.safePurchase.feeCents??0;
 const spCount=ready.filter(item=>item.safePurchaseAutomatic||safePurchaseOptIn&&item.safePurchaseOptional).length;
 const totals={items:ready.reduce((sum,item)=>sum+item.priceCents,0),shipping:ready.reduce((sum,item)=>sum+item.shippingCents,0),safePurchase:spEnabled?spCount*spFee:0};
 const total=totals.items+totals.shipping+totals.safePurchase;
 const tooMany=!!data&&ready.length>data.limits.maxCheckoutItems;

 async function act(action:string,item:CartItemView){
  setBusy(item.listingId);setActionError('');setNotice('');
  try{await post('/api/cart',{action,listingId:item.listingId});removeFromGuestCart(item.listingId);notifyCartChanged();setNotice(action==='remove'?'Removed “'+item.title+'”.':action==='save_for_later'?'Saved “'+item.title+'” for later.':'Moved “'+item.title+'” to your cart.');await load()}
  catch(problem){setActionError(problem instanceof Error?problem.message:'That didn’t work.')}
  finally{setBusy('')}
 }

 async function checkout(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current||!data||!ready.length||tooMany||!checkoutEnabled)return;
  const form=new FormData(event.currentTarget),field=(name:string)=>String(form.get(name)||'').trim();
  const shippingAddress={name:field('name'),line1:field('line1'),line2:field('line2'),city:field('city'),state:field('state').toUpperCase(),postalCode:field('postalCode'),country:'US'};
  const items=ready.map(item=>({listingId:item.listingId,priceCents:item.priceCents,shippingCents:item.shippingCents}));
  const optIn=safePurchaseOptIn&&spEnabled,key=JSON.stringify({items,shippingAddress,optIn});
  if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
  inFlight.current=true;setSubmitting(true);setCheckoutError('');
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),90000);
  try{
   const response=await fetch('/api/cart',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({action:'checkout',requestId:intent.current.id,sandboxAcknowledged:form.get('ack')==='on',safePurchaseOptIn:optIn,shippingAddress,items})});
   const result=await response.json().catch(()=>({})) as {error?:string;held?:{checkoutUrl:string|null}[]};
   // A definitive refusal ends this attempt; a retry after a timeout reuses the same request id (never a second order).
   if(!response.ok){intent.current=null;throw Error(result.error||'Checkout couldn’t start. Nothing was charged.')}
   intent.current=null;notifyCartChanged();setCheckingOut(false);
   const first=paymentUrl(result.held?.[0]?.checkoutUrl);
   if(first&&result.held?.length===1){window.location.assign(first);return}
   setNotice('Your comics are held. Pay for each one below.');await load();window.scrollTo({top:0,behavior:'smooth'});
  }catch(problem){setCheckoutError(abort.signal.aborted?'Checkout is taking longer than expected. Check the held comics above or Orders before trying again.':problem instanceof Error?problem.message:'Checkout couldn’t start.');await load()}
  finally{clearTimeout(timeout);inFlight.current=false;setSubmitting(false)}
 }

 if(guest)return <GuestCart/>;
 if(loadError&&!data)return <section className="cart-empty ds-card" role="alert"><h2>Your cart couldn’t load</h2><p>{loadError}</p><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>void load()}>Try again</button></section>;
 if(!data)return <p className="cart-loading" role="status">Loading your cart…</p>;

 return <div className="cart-layout">
  <div className="cart-col">
   {notice&&<p className="cart-notice" role="status">{notice}</p>}
   {actionError&&<p className="ds-error" role="alert">{actionError}</p>}
   {data.holds.length>0&&<Holds holds={data.holds} live={live} onChanged={()=>void load()}/>}
   {!active.length?<section className="cart-empty ds-card"><ShoppingCart size={34} aria-hidden/><h2>Your cart is empty</h2><p>Find a comic in the Marketplace and tap Add to cart.</p><Link className="ds-btn ds-btn-primary" href="/?section=Marketplace">Browse the Marketplace</Link></section>
   :groups.map(group=>{const shippable=group.items.filter(item=>item.checkoutReady),shipping=shippable.reduce((sum,item)=>sum+item.shippingCents,0),subtotal=shippable.reduce((sum,item)=>sum+item.priceCents,0);return <section key={group.seller.id||'removed'} className="cart-seller ds-card" aria-label={group.seller.name?'From '+group.seller.name:'Removed listings'}>
    <header className="cart-seller-head"><h2>{group.seller.name?<>From {group.seller.name}{group.seller.handle&&<small> @{group.seller.handle}</small>}</>:'Removed listings'}</h2>{group.seller.name&&<span>{group.items.length} {group.items.length===1?'comic':'comics'}</span>}</header>
    <ul className="cart-items">{group.items.map(item=><ItemRow key={item.listingId} item={item} busy={busy===item.listingId} onAction={(action,row)=>void act(action,row)}/>)}</ul>
    {shippable.length>0&&<dl className="cart-seller-foot"><div><dt>Items</dt><dd>{usd(subtotal)}</dd></div><div><dt>Shipping from this seller</dt><dd>{shipping?usd(shipping):'Free'}</dd></div></dl>}
   </section>})}
   {saved.length>0&&<section className="cart-saved ds-card" aria-labelledby="cart-saved-title"><h2 id="cart-saved-title"><Bookmark size={18} aria-hidden/> Saved for later</h2><ul className="cart-items">{saved.map(item=><ItemRow key={item.listingId} item={item} busy={busy===item.listingId} onAction={(action,row)=>void act(action,row)}/>)}</ul></section>}
  </div>

  {active.length>0&&<aside className="cart-summary ds-card" aria-labelledby="cart-summary-title">
   <h2 id="cart-summary-title">Order summary</h2>
   <dl className="cart-totals">
    <div><dt>Items ({ready.length})</dt><dd>{usd(totals.items)}</dd></div>
    <div><dt>Shipping</dt><dd>{totals.shipping?usd(totals.shipping):'Free'}</dd></div>
    {spEnabled&&totals.safePurchase>0&&<div><dt>SafePurchase ({spCount})</dt><dd>{usd(totals.safePurchase)}</dd></div>}
    <div className="cart-total"><dt>Total</dt><dd role="status" aria-live="polite">{usd(total)}</dd></div>
   </dl>
   {spEnabled&&ready.some(item=>item.safePurchaseOptional)&&<label className="check-label cart-check"><input type="checkbox" checked={safePurchaseOptIn} onChange={event=>setSafePurchaseOptIn(event.target.checked)}/><span><ShieldCheck size={15} aria-hidden/> Add SafePurchase to every comic{spFee?' ('+usd(spFee)+' each)':''}. We check each book before it ships to you.</span></label>}
   {spEnabled&&ready.some(item=>item.safePurchaseAutomatic)&&<p className="cart-fine"><ShieldCheck size={14} aria-hidden/> SafePurchase is on automatically for higher-value comics.</p>}
   <p className="cart-fine">Shipping is set by each seller per listing. Every comic is its own order and payment.</p>
   {active.length>ready.length&&<p className="cart-fine">Comics marked above aren’t included in this total.</p>}
   {tooMany&&<p className="ds-error" role="status">Check out up to {data.limits.maxCheckoutItems} comics at a time. Save the rest for later.</p>}
   {!checkingOut?<button type="button" className="ds-btn ds-btn-primary cart-checkout" disabled={!ready.length||tooMany||!checkoutEnabled} onClick={()=>setCheckingOut(true)}>Checkout</button>
   :<form className="cart-checkout-form" onSubmit={event=>void checkout(event)}>
    <h3>Ship to</h3>
    <label className="ds-field"><span>Recipient name *</span><input name="name" autoComplete="shipping name" required maxLength={100}/></label>
    <label className="ds-field"><span>Street address *</span><input name="line1" autoComplete="shipping address-line1" required maxLength={160}/></label>
    <label className="ds-field"><span>Apt or unit (optional)</span><input name="line2" autoComplete="shipping address-line2" maxLength={100}/></label>
    <div className="cart-address-grid"><label className="ds-field"><span>City *</span><input name="city" autoComplete="shipping address-level2" required maxLength={80}/></label><label className="ds-field"><span>State *</span><input name="state" autoComplete="shipping address-level1" required pattern="[A-Za-z]{2}" maxLength={2}/></label><label className="ds-field"><span>ZIP *</span><input name="postalCode" autoComplete="shipping postal-code" inputMode="numeric" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10}/></label></div>
    <p className="cart-fine">USA addresses only.</p>
    <label className="check-label cart-check"><input name="ack" type="checkbox" required/><span>{live?'I confirm these comics and this address. Stripe charges my card once per comic.':'This is a test checkout. I’ll use a Stripe test card. No real money moves.'}</span></label>
    {checkoutError&&<p className="ds-error" role="alert">{checkoutError}</p>}
    <button className="ds-btn ds-btn-primary cart-checkout" disabled={submitting||!ready.length||tooMany||!checkoutEnabled}>{submitting?'Holding your comics…':'Hold my comics and pay'}</button>
    <button type="button" className="ds-link" disabled={submitting} onClick={()=>setCheckingOut(false)}>Back</button>
   </form>}
   {!checkoutEnabled&&!payments.loading&&<p className="cart-fine" role="status">Online checkout is unavailable right now. Nothing will be charged.</p>}
   <p className="cart-fine"><LockKeyhole size={14} aria-hidden/> Checkout holds every comic for you first, so nobody else can buy them while you pay. Holds end after an hour if unpaid.</p>
  </aside>}
 </div>;
}
