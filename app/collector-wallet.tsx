'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw,ArrowDownLeft,ArrowUpRight,Package,Info} from 'lucide-react';
import {EmptyState,ErrorState,LoadingState} from '../components/states';
import './wallet/wallet.css';
type Balance={points:number;pointsDebt:number;availableCreditCents:number;reservedCreditCents:number};
type Rewards={balances:Record<'live'|'sandbox',Balance>;history:{id:string;kind:string;points_delta:number|string;credit_delta:number|string;created_at:string}[]};
type Data={rewards?:Rewards;live:{availableCents:string;pendingCents:string};sandbox:{availableCents:string;pendingCents:string};history:{id:string;order_id:string;mode:string;bucket:string;kind:string;amount_cents:string;created_at:string}[];hasMore:boolean;offset:number;unreconciledOrders:number;remainingOrders:number;withdrawalEnabled:boolean;note:string};
const usd=(cents:string|number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents)/100);
const when=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const labels:Record<string,string>={sale_pending:'Sale paid · waiting to release',pending_release:'Moved out of waiting',sale_proceeds:'Sale money released',pending_refund:'Sale refunded',purchase:'Purchase',refund:'Purchase refunded'};
const rewardLabels:Record<string,string>={purchase_points:'Points from a purchase',points_conversion:'Points turned into store credit',credit_spend:'Store credit used at checkout',credit_restore:'Store credit returned (refund)',points_reversal:'Points removed (refund)'};
function rewardLine(kind:string,points:number,credit:number){
 const parts:string[]=[];if(points)parts.push((points>0?'+':'−')+Math.abs(points).toLocaleString('en-US')+' pts');if(credit)parts.push((credit>0?'+':'−')+usd(Math.abs(credit))+' credit');
 return {label:rewardLabels[kind]||kind.replaceAll('_',' '),amount:parts.join(' → ')||'—'};
}
const hasActivity=(b?:Balance,c?:{availableCents:string;pendingCents:string})=>!!b&&(b.points||b.pointsDebt||b.availableCreditCents||b.reservedCreditCents)||!!c&&(Number(c.availableCents)||Number(c.pendingCents));
class SignedOut extends Error{}

export default function CollectorWallet({showInfoLink=true}:{showInfoLink?:boolean}={}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[signedOut,setSignedOut]=useState(false),[retry,setRetry]=useState(0),[offset,setOffset]=useState(0),[mode,setMode]=useState<'live'|'sandbox'>('live'),[loading,setLoading]=useState(true),[converting,setConverting]=useState(false),[conversionError,setConversionError]=useState(''),[converted,setConverted]=useState(''),[testSeen,setTestSeen]=useState(false);
 const conversion=useRef<{points:number;mode:string;id:string}|null>(null),busy=useRef(false);
 useEffect(()=>{
  let ignore=false;const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),20000);setError('');setLoading(true);
  void fetch('/api/wallet?'+new URLSearchParams({offset:String(offset),mode}),{signal:abort.signal,cache:'no-store',credentials:'same-origin'}).then(async response=>{if(response.status===401)throw new SignedOut();const body=await response.json();if(!response.ok)throw Error(body.error||'Couldn’t load your wallet. Try again.');if(!body.live||!body.sandbox||!Array.isArray(body.history))throw Error('Couldn’t load your wallet. Try again.');return body as Data}).then(value=>{if(!ignore){setSignedOut(false);setData(value);if(hasActivity(value.rewards?.balances.sandbox,value.sandbox))setTestSeen(true)}}).catch(problem=>{if(!ignore){setData(null);if(problem instanceof SignedOut){setSignedOut(true);return}setError(abort.signal.aborted?'Your wallet took too long to load. Try again.':problem instanceof Error&&problem.message?problem.message:'Couldn’t load your wallet. Try again.')}}).finally(()=>{clearTimeout(timeout);if(!ignore)setLoading(false)});
  return()=>{ignore=true;clearTimeout(timeout);abort.abort()};
 },[retry,offset,mode]);
 async function convert(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy.current)return;const points=Number(new FormData(event.currentTarget).get('points'));if(!Number.isSafeInteger(points)||points<100||points%100){setConversionError('Use blocks of 100 points (100, 200, 300…).');return}
  if(conversion.current?.points!==points||conversion.current.mode!==mode)conversion.current={points,mode,id:crypto.randomUUID()};busy.current=true;setConverting(true);setConversionError('');setConverted('');
  try{const response=await fetch('/api/wallet',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'convert_points',mode,points,requestId:conversion.current.id}),signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok)throw Error(body.error||'We’re not sure that went through. Refresh before trying again.');setData(value=>value?{...value,rewards:body.rewards}:value);conversion.current=null;setConverted(points.toLocaleString('en-US')+' points became '+usd(points)+' in store credit.');setRetry(value=>value+1)}catch(problem){setConversionError(problem instanceof Error&&problem.message?problem.message:'We’re not sure that went through. Refresh before trying again.')}finally{busy.current=false;setConverting(false)}
 }
 if(signedOut)return <section className="cw2" aria-label="Your wallet"><EmptyState title="Log in to see your wallet." message="Your points, store credit and sales money live here." action={{label:'Log in',href:'/sign-in?return_to=%2Fwallet'}} secondary={{label:'Join free',href:'/sign-in?mode=register&return_to=%2Fwallet'}}/></section>;
 const rewards=data?.rewards?.balances[mode],balance=data?.[mode],test=mode==='sandbox';
 const maxConvert=rewards?Math.min(1000000,Math.floor(rewards.points/100)*100):0;
 return <section className="cw2" aria-label="Your wallet">
  <div className="cw2-bar">
   {(testSeen||test)?<div className="cw2-tabs" role="group" aria-label="Which balance">{[{id:'live' as const,label:'My wallet'},{id:'sandbox' as const,label:'Test purchases'}].map(item=><button key={item.id} type="button" aria-pressed={mode===item.id} onClick={()=>{setMode(item.id);setOffset(0);setData(null);setConverted('');setConversionError('')}}>{item.label}</button>)}</div>:<p className="cw2-private">Only you can see this.</p>}
   <button type="button" className="cw2-icon" disabled={loading} aria-label="Refresh wallet" title="Refresh" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={18} aria-hidden="true"/></button>
  </div>
  {test&&<p className="cw2-test" role="note"><Info size={18} aria-hidden="true"/> Test purchases aren’t real money. These points and credit only work on test checkouts.</p>}
  {error&&<ErrorState compact message={error} action={{label:'Try again',onClick:()=>setRetry(value=>value+1)}}/>}
  {loading&&!data&&!error&&<LoadingState compact message="Loading your wallet…"/>}

  <div className="cw2-cards">
   <article className="cw2-card cw2-points"><h3>Points</h3><strong>{rewards?rewards.points.toLocaleString('en-US'):'—'}</strong><p>Every 100 points = $1 in store credit.</p></article>
   <article className="cw2-card"><h3>Store credit</h3><strong>{rewards?usd(rewards.availableCreditCents):'—'}</strong><p>{rewards?.reservedCreditCents?usd(rewards.reservedCreditCents)+' is held for an unpaid order. It comes back if that checkout is canceled or expires.':'Use it at checkout on ComicHuddle.'}</p></article>
   <article className="cw2-card"><h3>{test?'Test sales':'Sales proceeds'}</h3><strong>{balance?usd(balance.availableCents):'—'}</strong><p>{balance&&Number(balance.pendingCents)?usd(balance.pendingCents)+' waiting to release.':'Released to you.'}</p></article>
  </div>

  {rewards&&<div className="cw2-convert">
   {rewards.points>=100?<form className="cw2-form" onSubmit={event=>void convert(event)}><label className="ds-field"><span>Points to turn into credit</span><input name="points" type="number" inputMode="numeric" min="100" step="100" max={maxConvert} defaultValue={maxConvert>=100?100:undefined} required aria-describedby="cw2-convert-help"/><small id="cw2-convert-help">You have {rewards.points.toLocaleString('en-US')} points. Up to {usd(maxConvert)} available.</small></label><button className="ds-btn ds-btn-dark" disabled={converting}>{converting?'Converting…':'Get store credit'}</button></form>
   :<p className="cw2-progress">{rewards.points>0?`${(100-rewards.points%100)} more points until you get $1 in store credit.`:'No points yet. Earn 1 point for every $1 you spend on comics.'}</p>}
   {!!rewards.pointsDebt&&<p className="cw2-note">You owe {rewards.pointsDebt.toLocaleString('en-US')} points from a refunded order. Your next points go to that first.</p>}
   {converted&&<p role="status" className="cw2-success">{converted}</p>}
   {conversionError&&<p role="alert" className="ds-error">{conversionError}</p>}
  </div>}
  <p className="cw2-note">{test?'Test sales are for trying out checkout. They aren’t real money and can’t be withdrawn.':'Money from comics you sell through checkout shows here once payment clears. Cash sales and books you mark sold yourself don’t count. Withdrawals aren’t available yet.'}</p>

  {data&&<div className="cw2-history">
   <div className="ds-section-head"><div><h2>History<span>.</span></h2><p>{test?'Test purchases only.':'Your purchases, sales and rewards.'}</p></div></div>
   {data.unreconciledOrders>0&&<p role="status" className="cw2-note">{data.unreconciledOrders} {data.unreconciledOrders===1?'order is':'orders are'} still being checked and may not show yet.</p>}
   {data.remainingOrders>0&&<p role="status" className="cw2-note">More orders are still being checked. Refresh in a moment.</p>}
   {data.history.length?<ul className="cw2-list">{data.history.map(entry=><li key={entry.id}>{Number(entry.amount_cents)>=0?<ArrowDownLeft size={20} aria-label="Money in"/>:<ArrowUpRight size={20} aria-label="Money out"/>}<span><strong>{labels[entry.kind]||entry.kind.replaceAll('_',' ')}</strong><small>{when(entry.created_at)} · Order {entry.order_id.slice(0,8).toUpperCase()}</small></span><b>{usd(entry.amount_cents)}</b></li>)}</ul>:<p className="cw2-empty">Nothing here yet. Purchases, refunds and sales will show up here.</p>}
   {(offset>0||data.hasMore)&&<div className="cw2-pages"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-30))}>Newer</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!data.hasMore} onClick={()=>setOffset(value=>value+30)}>Older</button></div>}
   {data.rewards?.history.length?<details className="ds-how cw2-rewards"><summary>Rewards history</summary><div className="ds-how-body"><ul className="cw2-list">{data.rewards.history.map(entry=>{const line=rewardLine(entry.kind,Number(entry.points_delta),Number(entry.credit_delta));return <li key={entry.id}><span><strong>{line.label}</strong><small>{when(entry.created_at)}</small></span><b>{line.amount}</b></li>})}</ul></div></details>:null}
  </div>}
  <div className="ds-actions cw2-actions"><Link className="ds-btn ds-btn-secondary" href="/?section=Orders"><Package size={18} aria-hidden="true"/> Orders &amp; seller payouts</Link>{showInfoLink&&<Link className="ds-link" href="/wallet">How rewards work <ArrowUpRight size={16} aria-hidden="true"/></Link>}</div>
 </section>;
}
