'use client';
// Wallet → Bank payouts. Sellers connect a bank once through Stripe's hosted onboarding (Stripe Connect;
// ComicHuddle never sees or stores bank numbers). Amounts come from the seller's real orders (/api/commerce):
// "Pending" = paid but waiting on delivery, SafePurchase or pickup; "Ready to pay out" = the
// protection window ended. Payouts to the bank follow Stripe's automatic schedule.
import {useEffect,useState} from 'react';
import {Landmark,ExternalLink,Clock,CheckCircle2} from 'lucide-react';

type Order={id:string;title:string;role:string;status:string;sandbox:boolean;fulfillment?:'shipping'|'pickup';sellerNetCents?:number;fundsAvailableAt?:string|null;protection?:{tier?:string}|null};
type Overview={mode:'test'|'live';sandbox:boolean;payoutsEnabled:boolean;setup?:{ready?:boolean};seller?:{registered:boolean;onboardingRequired:boolean;ready:boolean};orders:Order[];hasMoreOrders?:boolean};
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const day=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const NOT_MONEY=new Set(['awaiting_payment','checkout_expired','cancelled','refunded','refund_pending','refund_eligible']);
const READY=new Set(['release_eligible','transfer_pending']);
function pendingReason(order:Order){
  if(order.status==='manual_review')return 'On hold while ComicHuddle reviews it';
  if(order.status==='delivered_review'||order.status==='picked_up')return order.fundsAvailableAt?'Buyer’s review window ends '+day(order.fundsAvailableAt):'Buyer’s review window is open';
  if(order.protection?.tier==='safepurchase')return 'Waiting on SafePurchase (our check and delivery)';
  if(order.fulfillment==='pickup')return 'Waiting on the pickup PIN';
  return 'Waiting on delivery';
}

export default function BankPayouts({mode}:{mode:'live'|'sandbox'}){
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState(''),[connecting,setConnecting]=useState(false),[connectError,setConnectError]=useState('');
  useEffect(()=>{
    let live=true;const abort=new AbortController();
    fetch('/api/commerce',{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Couldn’t load your payouts.');return body as Overview})
      .then(value=>{if(live)setData(value)}).catch(problem=>{if(live&&!abort.signal.aborted)setError(problem instanceof Error?problem.message:'Couldn’t load your payouts.')});
    return()=>{live=false;abort.abort()};
  },[]);
  async function connect(){
    if(connecting)return;setConnecting(true);setConnectError('');
    try{
      const response=await fetch('/api/commerce',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seller_onboard',sandboxAcknowledged:true})});
      const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'Couldn’t open Stripe. Try again.');
      const url=typeof body.onboardingUrl==='string'?new URL(body.onboardingUrl):null;
      if(!url||url.protocol!=='https:'||!['connect.stripe.com','accounts.stripe.com'].includes(url.hostname))throw Error(body.ready?'Your bank is already connected.':'Couldn’t open Stripe. Try again.');
      window.location.assign(url.href);
    }catch(problem){setConnectError(problem instanceof Error?problem.message:'Couldn’t open Stripe. Try again.');setConnecting(false)}
  }
  if(error)return <section className="cw2-payouts" aria-label="Bank payouts"><h3><Landmark size={18} aria-hidden="true"/> Bank payouts</h3><p className="cw2-note" role="alert">{error}</p></section>;
  if(!data)return null;
  const test=mode==='sandbox',seller=data.seller,orders=data.orders.filter(o=>o.role==='seller'&&o.sandbox===test&&!NOT_MONEY.has(o.status)&&typeof o.sellerNetCents==='number');
  // The server's current payment mode decides which Stripe account a connect button binds.
  const modeMatches=test?data.mode!=='live':data.mode==='live';
  const pending=orders.filter(o=>!READY.has(o.status)&&o.status!=='transferred'),ready=orders.filter(o=>READY.has(o.status)),sent=orders.filter(o=>o.status==='transferred');
  const sum=(list:Order[])=>list.reduce((total,o)=>total+(o.sellerNetCents||0),0);
  const payoutReason=!data.payoutsEnabled?'Pay out now isn’t available yet. Seller payouts switch on once delivery tracking and payments are live; then money goes to your bank automatically on Stripe’s schedule.':'Payouts go to your bank automatically on Stripe’s schedule.';
  return <section className="cw2-payouts" aria-labelledby="cw2-payouts-title">
    <div className="ds-section-head"><div><h2 id="cw2-payouts-title">Bank <span>payouts.</span></h2><p>{test?'Test sales only. Test money never reaches a bank.':'Money from comics you sell through ComicHuddle checkout.'}</p></div></div>
    <div className="cw2-cards">
      <article className="cw2-card"><h3><Clock size={16} aria-hidden="true"/> Pending</h3><strong>{usd(sum(pending))}</strong><p>{pending.length?`${pending.length} ${pending.length===1?'sale':'sales'} waiting on delivery, SafePurchase or a pickup code.`:'Nothing waiting.'}</p></article>
      <article className="cw2-card"><h3><CheckCircle2 size={16} aria-hidden="true"/> Ready to pay out</h3><strong>{usd(sum(ready))}</strong><p>{ready.length?'The buyer’s review window has ended.':'Nothing ready yet.'}</p></article>
      {sent.length>0&&<article className="cw2-card"><h3>Sent to Stripe</h3><strong>{usd(sum(sent))}</strong><p>Stripe pays this to your bank on its schedule.</p></article>}
    </div>
    <div className="cw2-bank">
      {!modeMatches?<p className="cw2-note">{test?'Test payouts are only available while ComicHuddle runs test payments.':'Bank connection opens when ComicHuddle switches to live payments.'}</p>
      :seller?.ready?<p className="cw2-success" role="status"><Landmark size={18} aria-hidden="true"/> Bank connected through Stripe{data.mode==='test'?' (test mode)':''}. We never see your bank details.</p>
      :<>
        <p className="cw2-note">{seller?.registered?'Finish connecting your bank with Stripe to get paid.':'Connect your bank once to get paid for sales. Stripe handles it; ComicHuddle never sees or stores your bank details.'}{data.mode==='test'?' This is Stripe test mode: use Stripe’s test details, not your real bank.':''}</p>
        <button type="button" className="ds-btn ds-btn-dark" onClick={()=>void connect()} disabled={connecting||data.setup?.ready===false}>{connecting?'Opening Stripe…':seller?.registered?'Finish bank setup':'Connect bank'} <ExternalLink size={16} aria-hidden="true"/></button>
        {data.setup?.ready===false&&<p className="cw2-note">Payments aren’t set up on this site yet, so bank connection is unavailable.</p>}
        {connectError&&<p role="alert" className="ds-error">{connectError}</p>}
      </>}
      <div className="cw2-payout-now">
        <button type="button" className="ds-btn ds-btn-secondary" disabled aria-describedby="cw2-payout-reason">Pay out now</button>
        <p id="cw2-payout-reason" className="cw2-note">{payoutReason}</p>
      </div>
    </div>
    {(pending.length>0||ready.length>0)&&<ul className="cw2-list">{[...ready,...pending].slice(0,20).map(o=><li key={o.id}><span><strong>{o.title}</strong><small>{READY.has(o.status)?'Ready to pay out':pendingReason(o)} · Order {o.id.slice(0,8).toUpperCase()}</small></span><b>{usd(o.sellerNetCents||0)}</b></li>)}</ul>}
    {data.hasMoreOrders&&<p className="cw2-note">Showing your latest 100 orders.</p>}
  </section>;
}
