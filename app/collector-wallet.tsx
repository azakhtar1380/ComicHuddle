'use client';
import {useEffect,useRef,useState} from 'react';
import {Wallet,RefreshCw,Clock,ArrowDownLeft,ArrowUpRight,Package,Gift,Info} from 'lucide-react';
import './wallet/wallet.css';
type Balance={points:number;pointsDebt:number;availableCreditCents:number;reservedCreditCents:number};
type Rewards={balances:Record<'live'|'sandbox',Balance>;history:{id:string;kind:string;points_delta:number|string;credit_delta:number|string;created_at:string}[]};
type Data={rewards?:Rewards;live:{availableCents:string;pendingCents:string};sandbox:{availableCents:string;pendingCents:string};history:{id:string;order_id:string;mode:string;bucket:string;kind:string;amount_cents:string;created_at:string}[];hasMore:boolean;offset:number;unreconciledOrders:number;remainingOrders:number;withdrawalEnabled:boolean;note:string};
const usd=(cents:string|number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents)/100);
const when=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const labels:Record<string,string>={sale_pending:'Sale paid · waiting for release',pending_release:'Moved out of pending',sale_proceeds:'Sale proceeds released',pending_refund:'Sale refunded',purchase:'Purchase',refund:'Purchase refunded'};
const rewardLabels:Record<string,string>={purchase_points:'Points earned on a purchase',points_conversion:'Points turned into store credit',credit_spend:'Store credit used at checkout',credit_restore:'Store credit returned (refund)',points_reversal:'Points removed (refund)'};
function rewardLine(kind:string,points:number,credit:number){
 const parts:string[]=[];if(points)parts.push((points>0?'+':'−')+Math.abs(points).toLocaleString('en-US')+' pts');if(credit)parts.push((credit>0?'+':'−')+usd(Math.abs(credit))+' credit');
 return {label:rewardLabels[kind]||kind.replaceAll('_',' '),amount:parts.join(' → ')||'—'};
}
const hasActivity=(b?:Balance,c?:{availableCents:string;pendingCents:string})=>!!b&&(b.points||b.pointsDebt||b.availableCreditCents||b.reservedCreditCents)||!!c&&(Number(c.availableCents)||Number(c.pendingCents));

export default function CollectorWallet(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[offset,setOffset]=useState(0),[mode,setMode]=useState<'live'|'sandbox'>('live'),[loading,setLoading]=useState(true),[converting,setConverting]=useState(false),[conversionError,setConversionError]=useState(''),[converted,setConverted]=useState(''),[testSeen,setTestSeen]=useState(false);
 const conversion=useRef<{points:number;mode:string;id:string}|null>(null),busy=useRef(false);
 useEffect(()=>{
  let ignore=false;const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),20000);setError('');setLoading(true);
  void fetch('/api/wallet?'+new URLSearchParams({offset:String(offset),mode}),{signal:abort.signal,cache:'no-store',credentials:'same-origin'}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Your wallet is unavailable right now.');if(!body.live||!body.sandbox||!Array.isArray(body.history))throw Error('Your wallet could not be verified. Please retry.');return body as Data}).then(value=>{if(!ignore){setData(value);if(hasActivity(value.rewards?.balances.sandbox,value.sandbox))setTestSeen(true)}}).catch(problem=>{if(!ignore){setData(null);setError(abort.signal.aborted?'Loading your wallet took too long. Please retry.':problem instanceof Error?problem.message:'Your wallet is unavailable right now.')}}).finally(()=>{clearTimeout(timeout);if(!ignore)setLoading(false)});
  return()=>{ignore=true;clearTimeout(timeout);abort.abort()};
 },[retry,offset,mode]);
 async function convert(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy.current)return;const points=Number(new FormData(event.currentTarget).get('points'));if(!Number.isSafeInteger(points)||points<100||points%100){setConversionError('Enter points in blocks of 100 (100, 200, 300…).');return}
  if(conversion.current?.points!==points||conversion.current.mode!==mode)conversion.current={points,mode,id:crypto.randomUUID()};busy.current=true;setConverting(true);setConversionError('');setConverted('');
  try{const response=await fetch('/api/wallet',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'convert_points',mode,points,requestId:conversion.current.id}),signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok)throw Error(body.error||'The conversion wasn’t confirmed. Refresh before trying again.');setData(value=>value?{...value,rewards:body.rewards}:value);conversion.current=null;setConverted(points.toLocaleString('en-US')+' points became '+usd(points)+' in store credit.');setRetry(value=>value+1)}catch(problem){setConversionError(problem instanceof Error?problem.message:'The conversion wasn’t confirmed. Refresh before trying again.')}finally{busy.current=false;setConverting(false)}
 }
 const rewards=data?.rewards?.balances[mode],balance=data?.[mode],test=mode==='sandbox';
 const maxConvert=rewards?Math.min(1000000,Math.floor(rewards.points/100)*100):0;
 return <section className="collector-wallet cw" aria-label="Your wallet">
  <div className="cw-heading"><div><span className="eyebrow">Private to you</span><h3><Wallet size={21} aria-hidden="true"/> Wallet &amp; rewards</h3></div><button type="button" className="inline-button" disabled={loading} aria-label="Refresh wallet" title="Refresh" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/></button></div>
  {(testSeen||test)&&<div className="cw-tabs" role="group" aria-label="Which balance">{[{id:'live' as const,label:'My wallet'},{id:'sandbox' as const,label:'Test purchases'}].map(item=><button key={item.id} type="button" aria-pressed={mode===item.id} onClick={()=>{setMode(item.id);setOffset(0);setData(null);setConverted('');setConversionError('')}}>{item.label}</button>)}</div>}
  {test&&<p className="cw-test-note" role="note"><Info size={15} aria-hidden="true"/> Test purchases use test payments, not real money. These points and credit only work on test checkouts.</p>}

  <div className="cw-rewards">
   <h4><Gift size={17} aria-hidden="true"/> Collector Rewards</h4>
   <div className="cw-balances"><div><small>Reward points</small><strong>{rewards?rewards.points.toLocaleString('en-US'):'—'}</strong></div><div><small>Store credit</small><strong>{rewards?usd(rewards.availableCreditCents):'—'}</strong></div></div>
   <p className="cw-note">Earn 1 point for every whole dollar you spend on items (not shipping or tax). Every 100 points = $1 store credit. Store credit can be used on ComicHuddle purchases; it can’t be cashed out or sent to someone else.</p>
   {!!rewards?.reservedCreditCents&&<p className="cw-note">{usd(rewards.reservedCreditCents)} of your credit is held for an unpaid order. It comes back if that checkout is cancelled or expires.</p>}
   {!!rewards?.pointsDebt&&<p className="cw-note">You owe {rewards.pointsDebt.toLocaleString('en-US')} points from a refunded order whose points were already used. Your next points go toward that first.</p>}
   {rewards&&(rewards.points>=100?<form className="cw-conversion" onSubmit={event=>void convert(event)}><label>Points to convert<input name="points" type="number" min="100" step="100" max={maxConvert} defaultValue={maxConvert>=100?100:undefined} required/></label><button className="button red small-button" disabled={converting}>{converting?'Converting…':'Turn into store credit'}</button><small>You have {rewards.points.toLocaleString('en-US')} points. Up to {usd(maxConvert)} available.</small></form>
    :<p className="cw-note cw-progress-note">{rewards.points>0?`${(100-rewards.points%100)} more points until you can get $1 in store credit.`:'You don’t have any points yet. Your first eligible purchase starts earning them.'}</p>)}
   {converted&&<p role="status" className="cw-success">{converted}</p>}
   {conversionError&&<p role="alert" className="cw-error">{conversionError}</p>}
   <a className="inline-button" href="/wallet">How rewards work <ArrowUpRight size={14} aria-hidden="true"/></a>
   {data?.rewards?.history.length?<details className="cw-reward-history"><summary>Rewards history</summary><ul>{data.rewards.history.map(entry=>{const line=rewardLine(entry.kind,Number(entry.points_delta),Number(entry.credit_delta));return <li key={entry.id}><span>{line.label}<small>{when(entry.created_at)}</small></span><b>{line.amount}</b></li>})}</ul></details>:null}
  </div>

  <h4 className="cw-section-title">Sales money</h4>
  <div className="cw-balances"><div><small>{test?'Test sales released':'Released to you'}</small><strong>{balance?usd(balance.availableCents):'—'}</strong></div><div><small><Clock size={12} aria-hidden="true"/> Waiting for release</small><strong>{balance?usd(balance.pendingCents):'—'}</strong></div></div>
  <p className="cw-note">{test?'Test sales are for trying out checkout. They aren’t real money and can’t be withdrawn.':'Money from items you sell through ComicHuddle checkout shows here once the payment is confirmed. Cash sales and listings you mark as sold yourself don’t add money. Withdrawals aren’t available yet.'}</p>
  {error&&<div className="cw-recovery" role="alert"><p>{error}</p><button type="button" className="inline-button" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15} aria-hidden="true"/> Try again</button></div>}
  {loading&&<p role="status" className="cw-note">Loading your wallet…</p>}
  {data&&<>{data.unreconciledOrders>0&&<p role="status" className="cw-note">{data.unreconciledOrders} {data.unreconciledOrders===1?'order is':'orders are'} still being checked and may not be included yet.</p>}{data.remainingOrders>0&&<p role="status" className="cw-note">More orders are still being checked. Refresh in a moment.</p>}
   <div className="cw-history"><div className="cw-history-filter"><h4>History</h4><small>{test?'Test purchases only':'Real purchases and sales'}</small></div>
    {data.history.length?<ul>{data.history.map(entry=><li className="cw-entry" key={entry.id}>{Number(entry.amount_cents)>=0?<ArrowDownLeft size={18} aria-label="Money in"/>:<ArrowUpRight size={18} aria-label="Money out"/>}<span><strong>{labels[entry.kind]||entry.kind.replaceAll('_',' ')}</strong><small>{when(entry.created_at)} · Order {entry.order_id.slice(0,8).toUpperCase()}</small></span><b>{usd(entry.amount_cents)}</b></li>)}</ul>:<p className="cw-note">Nothing here yet. Paid purchases, refunds and sales will show up here.</p>}
   </div>
   {(offset>0||data.hasMore)&&<div className="cw-pages"><button type="button" className="inline-button" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-30))}>Newer</button><button type="button" className="inline-button" disabled={!data.hasMore} onClick={()=>setOffset(value=>value+30)}>Older</button></div>}
  </>}
  <a className="button outline small-button" href="/?section=Orders"><Package size={16} aria-hidden="true"/> Orders &amp; seller payment setup</a>
 </section>;
}
