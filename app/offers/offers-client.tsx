'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,Check,Clock,MessageCircle,RefreshCw,Repeat2,X} from 'lucide-react';
import UserAvatar from '../../components/user-avatar';
import ComicCoverPlaceholder from '../../components/comic-cover-placeholder';
import {EmptyState,LoadingState} from '../../components/states';
import {accountLinks} from '../../components/account-prompt';
import OfferCheckout from '../../components/offers/offer-checkout';

type Item={title:string;issue:string;grade:string};
type Row={kind:'offer'|'trade';id:string;tab:'received'|'sent';listing:{id:string;title:string;priceCents:number;shippingCents:number;photoId:string|null;available:boolean;fulfillment:string};other:{id:string;name:string;handle:string;color:string;avatarUrl:string|null};
 status:'pending'|'countered'|'accepted'|'declined'|'expired'|'withdrawn'|'closed'|'ordered'|'cancelled';yourTurn:boolean;deadline:string|null;createdAt:string;amountCents?:number;originalCents?:number|null;rounds?:number;note?:string;orderId?:string|null;orderStatus?:string|null;
 trade?:{threadId:string;version:number;offered:Item[];requested:Item[]};actions:{accept:boolean;counter:boolean;decline:boolean;withdraw:boolean;pay:boolean;cancel:boolean;message:boolean}};
type Data={received:Row[];sent:Row[];ttlHours:number;counterOffers:boolean};
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const STATUS:Record<Row['status'],string>={pending:'Pending',countered:'Countered',accepted:'Accepted',declined:'Declined',expired:'Expired',withdrawn:'Withdrawn',closed:'Closed',ordered:'Ordered',cancelled:'Cancelled'};
function left(deadline:string|null,now:number){
 if(!deadline)return null;const ms=Date.parse(deadline)-now;if(!Number.isFinite(ms))return null;if(ms<=0)return 'Expired';
 const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);return h>=1?h+'h '+m+'m left':m+'m left';
}
function valid(value:unknown):value is Data{const d=value as Partial<Data>;return !!d&&Array.isArray(d.received)&&Array.isArray(d.sent)&&typeof d.ttlHours==='number'}
type Loaded={guest:true}|{error:string}|{data:Data};
async function fetchOffers():Promise<Loaded>{
 try{const r=await fetch('/api/offers',{cache:'no-store',credentials:'same-origin'});if(r.status===401)return {guest:true};const d:unknown=await r.json();
  if(!r.ok)return {error:typeof (d as {error?:unknown})?.error==='string'?(d as {error:string}).error:'Offers could not load.'};if(!valid(d))return {error:'Offers could not be read.'};return {data:d}}
 catch{return {error:'Offers could not load. Check your connection and try again.'}}
}
const itemLine=(items:Item[])=>items.map(i=>[i.title,i.issue].filter(Boolean).join(' ')+(i.grade?' ('+i.grade+')':'')).join(', ');

function Cover({row}:{row:Row}){
 const [broken,setBroken]=useState(false);
 return row.listing.photoId&&!broken?<img className="of-cover" src={'/api/media?id='+encodeURIComponent(row.listing.photoId)} alt="" loading="lazy" onError={()=>setBroken(true)}/>:<ComicCoverPlaceholder className="of-cover" title={row.listing.title} message=""/>;
}

function OfferCard({row,now,busy,onAct,onPaid}:{row:Row;now:number;busy:boolean;onAct:(row:Row,body:Record<string,unknown>)=>Promise<boolean>;onPaid:()=>void}){
 const [counter,setCounter]=useState(false),[confirm,setConfirm]=useState<'accept'|'decline'|null>(null),[consent,setConsent]=useState(false),[paying,setPaying]=useState(false),[value,setValue]=useState('');
 const amount=row.amountCents??0,timeLeft=row.status==='pending'||row.status==='countered'||row.status==='accepted'?left(row.deadline,now):null,received=row.tab==='received';
 const listingHref='/?section=Marketplace&listing='+encodeURIComponent(row.listing.id),messageHref='/?section=Messages&to='+encodeURIComponent(row.other.id)+'&listing='+encodeURIComponent(row.listing.id);
 const respond=(decision:string,extra:Record<string,unknown>={})=>row.kind==='offer'?{action:'respond',offerId:row.id,decision,expectedStatus:row.status==='countered'?'countered':'pending',expectedAmount:amount,...extra}:{action:'trade',proposalId:row.id,decision,expectedVersion:row.trade!.version,...extra};
 async function send(body:Record<string,unknown>){const ok=await onAct(row,body);if(ok){setCounter(false);setConfirm(null);setValue('')}}
 const counterCents=Math.round(Number(value)*100),counterValid=Number.isFinite(counterCents)&&counterCents>=100&&counterCents<=row.listing.priceCents&&(row.status==='pending'?counterCents>amount:counterCents<amount);
 const whose=row.kind==='trade'?(received?'Offered to you':'You offered'):row.status==='countered'?(received?'Your counter':'Their counter'):received?'Their offer':row.rounds?'Your counter':'Your offer';
 return <article className={'of-card of-'+row.status+(row.yourTurn?' is-your-turn':'')}>
  <a className="of-cover-link" href={listingHref} aria-label={'Open listing: '+row.listing.title}><Cover row={row}/></a>
  <div className="of-body">
   <div className="of-top"><a className="of-title" href={listingHref}>{row.listing.title}</a><span className={'of-status of-status-'+row.status}>{row.kind==='trade'&&<Repeat2 size={13} aria-hidden="true"/>}{STATUS[row.status]}</span></div>
   <div className="of-person"><UserAvatar name={row.other.name} src={row.other.avatarUrl} color={row.other.color||undefined} size={28}/><span>{received?'From ':'To '}<b>{row.other.name}</b>{row.other.handle&&<small> @{row.other.handle}</small>}</span></div>
   {row.kind==='offer'?<dl className="of-terms"><div><dt>{whose}</dt><dd className="of-price">{dollars(amount)}</dd></div><div><dt>List price</dt><dd>{row.listing.priceCents?dollars(row.listing.priceCents):'Not listed'}</dd></div>{row.originalCents&&row.originalCents!==amount?<div><dt>First offer</dt><dd>{dollars(row.originalCents)}</dd></div>:null}</dl>
    :<dl className="of-terms of-trade"><div><dt>{whose}</dt><dd>{itemLine(row.trade!.offered)||'No comics listed'}</dd></div><div><dt>In exchange for</dt><dd>{itemLine(row.trade!.requested)||row.listing.title}</dd></div></dl>}
   {row.note&&<p className="of-note">“{row.note}”</p>}
   <p className="of-meta">{timeLeft&&<span className={timeLeft==='Expired'?'of-expired':''}><Clock size={13} aria-hidden="true"/> {row.status==='accepted'?'Pay within: ':row.yourTurn?'Reply within: ':'Waiting · '}{timeLeft}</span>}<span>{new Date(row.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span></p>
   {row.status==='accepted'&&row.kind==='offer'&&!received&&row.orderStatus==='awaiting_payment'&&<p className="of-hint">You started checkout. <Link href="/?section=Orders&role=buyer">Finish payment in Orders</Link>.</p>}
   {row.status==='accepted'&&row.kind==='offer'&&received&&<p className="of-hint">Accepted. Waiting for the buyer to pay{row.deadline?' (48-hour window)':''}. You’ll get a notification once it’s paid.</p>}
   {row.status==='ordered'&&<p className="of-hint">Paid. <Link href={'/?section=Orders&role='+(received?'seller':'buyer')}>View the order</Link>.</p>}
   {row.status==='accepted'&&row.kind==='trade'&&<p className="of-hint">Terms agreed. Trades aren’t paid or protected through ComicHuddle: arrange the swap in Messages.</p>}
   {paying&&row.kind==='offer'?<OfferCheckout offerId={row.id} title={row.listing.title} amountCents={amount} shippingCents={row.listing.shippingCents} fulfillment={row.listing.fulfillment} onClose={()=>{setPaying(false);onPaid()}}/>:
   <div className="of-actions">
    {row.actions.pay&&(row.orderStatus==='awaiting_payment'?<Link className="ds-btn ds-btn-primary ds-btn-sm" href="/?section=Orders&role=buyer">Finish payment <ArrowUpRight size={14}/></Link>:<button type="button" className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy} onClick={()=>setPaying(true)}>Pay {dollars(amount)}</button>)}
    {row.actions.accept&&(confirm==='accept'?<>
      {row.kind==='trade'&&<label className="of-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I agree to these terms. This doesn’t move any comics or money.</label>}
      <button type="button" className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy||row.kind==='trade'&&!consent} onClick={()=>void send(respond('accept',row.kind==='trade'?{agreementOnlyConsent:true}:{}))}><Check size={15}/> {row.kind==='offer'?'Confirm: accept '+dollars(amount):'Confirm trade'}</button>
      <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>setConfirm(null)}>Back</button></>
     :<button type="button" className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy} onClick={()=>{setConfirm('accept');setCounter(false)}}><Check size={15}/> Accept</button>)}
    {row.kind==='offer'&&row.actions.counter&&confirm!=='accept'&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" aria-expanded={counter} disabled={busy} onClick={()=>setCounter(v=>!v)}>Counter</button>}
    {row.kind==='trade'&&row.actions.counter&&confirm!=='accept'&&<a className="ds-btn ds-btn-secondary ds-btn-sm" href={messageHref}>Counter in Messages</a>}
    {row.actions.decline&&confirm!=='accept'&&(confirm==='decline'?<><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>void send(respond('decline'))}><X size={15}/> Confirm decline</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>setConfirm(null)}>Back</button></>:<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>setConfirm('decline')}><X size={15}/> Decline</button>)}
    {row.actions.withdraw&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>void send(respond('withdraw'))}>Withdraw offer</button>}
    {row.actions.cancel&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>void send(respond('cancel'))}>Cancel proposal</button>}
    <a className="of-message" href={messageHref}><MessageCircle size={15} aria-hidden="true"/> Message</a>
   </div>}
   {counter&&<form className="of-counter" onSubmit={e=>{e.preventDefault();if(counterValid)void send(respond('counter',{amount:counterCents}))}}>
    <label><span>Your counter-offer</span><span className="of-money"><b aria-hidden="true">$</b><input inputMode="decimal" required value={value} onChange={e=>setValue(e.target.value.replace(/[^\d.]/g,''))} aria-describedby={'counter-help-'+row.id} placeholder={(row.status==='pending'?Math.min(row.listing.priceCents,amount+100):Math.max(100,amount-100))/100+''}/></span></label>
    <small id={'counter-help-'+row.id}>{row.status==='pending'?'Higher than '+dollars(amount):'Lower than '+dollars(amount)}, up to the list price of {dollars(row.listing.priceCents)}. They get 48 hours to reply.</small>
    <div className="of-actions"><button className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy||!counterValid}>Send counter</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setCounter(false)}>Cancel</button></div>
   </form>}
  </div>
 </article>;
}

export default function OffersClient(){
 const [tab,setTab]=useState<'received'|'sent'>(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('tab')==='sent'?'sent':'received');
 const [data,setData]=useState<Data|null>(null),[guest,setGuest]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(()=>Date.now()),mounted=useRef(true);
 const apply=useCallback((result:Loaded)=>{if(!mounted.current)return;if('guest'in result)setGuest(true);else if('error'in result)setError(result.error);else{setData(result.data);setError('')}},[]);
 const load=useCallback(()=>fetchOffers().then(apply),[apply]);
 useEffect(()=>{mounted.current=true;void fetchOffers().then(apply);const tick=setInterval(()=>setNow(Date.now()),30000),poll=setInterval(()=>{if(document.visibilityState==='visible')void load()},60000);return()=>{mounted.current=false;clearInterval(tick);clearInterval(poll)}},[load,apply]);
 function choose(next:'received'|'sent'){setTab(next);const url=new URL(window.location.href);url.searchParams.set('tab',next);window.history.replaceState(null,'',url)}
 async function act(_row:Row,body:Record<string,unknown>){setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/offers',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(typeof d?.error==='string'?d.error:'That didn’t go through. Refresh and try again.');setNotice(typeof d.note==='string'?d.note:'Updated.');await load();return true}catch(e){setError(e instanceof Error?e.message:'That didn’t go through.');await load();return false}finally{setBusy(false)}}
 if(guest){const links=accountLinks();return <EmptyState title="Sign in to see your offers" message="Offers and trade proposals you send or receive show up here." action={{label:'Sign in',href:links.signIn}} secondary={{label:'Create a free account',href:links.join}}/>}
 const rows=data?data[tab]:[],waiting=(list:Row[])=>list.filter(r=>r.yourTurn).length;
 return <section className="of-panel" aria-label="Offers and trades">
  <div className="of-toolbar">
   <div className="of-tabs" role="tablist" aria-label="Offers">{(['received','sent'] as const).map(value=>{const list=data?.[value]||[],count=waiting(list);return <button key={value} type="button" role="tab" id={'of-tab-'+value} aria-controls="of-tabpanel" aria-selected={tab===value} className={tab===value?'is-on':''} onClick={()=>choose(value)}>{value==='received'?'Received':'Sent'} <span className="of-count">{list.length}</span>{count>0&&<span className="of-badge" aria-label={count+' waiting on you'}>{count}</span>}</button>})}</div>
   <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={()=>void load()}><RefreshCw size={14}/> Refresh</button>
  </div>
  {error&&<p className="ds-error" role="alert">{error}</p>}{notice&&<p className="of-notice" role="status">{notice}</p>}
  {data&&!data.counterOffers&&<p className="data-caption">Counter-offers switch on once the owner applies the latest database update. Accept and decline work now.</p>}
  <div id="of-tabpanel" role="tabpanel" aria-labelledby={'of-tab-'+tab}>
   {!data&&!error&&<LoadingState compact message="Loading your offers…"/>}
   {data&&!rows.length&&<EmptyState compact title={tab==='received'?'No offers received yet':'No offers sent yet'} message={tab==='received'?'When collectors make offers or propose trades on your listings, they show up here.':'Make an offer or propose a trade from any fixed-price listing.'} secondary={{label:'Browse the marketplace',href:'/?section=Marketplace'}}/>}
   {rows.map(row=><OfferCard key={row.kind+row.id} row={row} now={now} busy={busy} onAct={act} onPaid={()=>void load()}/>)}
  </div>
 </section>;
}
