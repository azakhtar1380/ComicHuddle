'use client';
import {useEffect,useRef,useState} from 'react';
import {Gavel,RefreshCw,Search,X} from 'lucide-react';
type AuctionRow={id:string;title:string;status:string;endAt:string;bidCount:number;price:number;currentBid:number|null;seller:{name:string;handle:string}};
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export default function AuctionAdmin({notify,onChanged}:{notify:(s:string)=>void;onChanged:()=>void}){
 const [rows,setRows]=useState<AuctionRow[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string|null>(null);
 const latest=useRef(0),busyRef=useRef(false),mounted=useRef(false),currentQuery=useRef('');
 async function load(id=currentQuery.current){
  currentQuery.current=id;const request=++latest.current;setLoading(true);setConfirm(null);
  try{const r=await fetch('/api/social?kind=auctions_admin'+(id?'&id='+encodeURIComponent(id):'')),d=await r.json() as {error?:string;auctions?:AuctionRow[]};if(!r.ok)throw Error(d.error||'Auction support queue unavailable.');if(!Array.isArray(d.auctions))throw Error('Auction support queue returned an invalid response.');if(request===latest.current&&mounted.current){setRows(d.auctions);setError('')}}
  catch(e){if(request===latest.current&&mounted.current){setRows([]);setError(e instanceof Error?e.message:'Auction support queue unavailable.')}}
  finally{if(request===latest.current&&mounted.current)setLoading(false)}
 }
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;latest.current++}},[]);
 async function cancel(id:string){
  if(busyRef.current)return;busyRef.current=true;setBusy(true);
  try{const r=await fetch('/api/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel_auction',listingId:id})}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error||'Preview cancellation failed.');if(!mounted.current)return;setConfirm(null);await load();onChanged();notify('Auction preview cancelled. Copy reservations released; bid audit history retained. No payment or order exists.')}
  catch(e){if(mounted.current)notify(e instanceof Error?e.message:'Preview cancellation failed.')}
  finally{busyRef.current=false;if(mounted.current)setBusy(false)}
 }
 return <section><div className="page-intro"><div><div className="eyebrow">SITE OWNER / AUCTION SUPPORT</div><h1>KEEP THE HUNT<br/><span>HONEST.</span></h1><p>Resolve reported listing errors and account-closure requests. These are nonbinding previews; cancellation does not issue a refund or reverse a paid order.</p></div><button className="button outline" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={16}/> Refresh previews</button></div>
  <form className="marketplace-tools" onSubmit={e=>{e.preventDefault();void load(query.trim())}}><label className="search-bar"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a preview by its exact listing ID…" aria-label="Auction listing ID" maxLength={100}/></label><button className="button dark" disabled={busy||loading}>Find preview</button>{query&&<button type="button" className="button outline" disabled={busy||loading} onClick={()=>{setQuery('');void load('')}}>Recent previews</button>}</form>
  <p className="data-caption">The latest 100 previews are shown by default, including hidden and ended listings. Search by listing ID to find an older preview. Bidder identities and private collection costs are excluded.</p>
  {error&&<p className="network-error" role="alert">{error}</p>}{loading&&<p role="status">Loading auction previews…</p>}
  {!loading&&rows.map(row=><article className="moderation-card" key={row.id}><div className="eyebrow">{row.status.toUpperCase()} / {row.bidCount} ACCEPTED PREVIEW BIDS</div><h3>{row.title}</h3><p>{row.seller.name} {row.seller.handle&&'@'+row.seller.handle} · {usd(row.currentBid??row.price)} {row.currentBid===null?'opening amount':'last current amount'}</p><p className="data-caption">Listing ID: {row.id}<br/>Cutoff: {new Date(row.endAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} Central</p>
   {['active','ended'].includes(row.status)&&(confirm===row.id?<form onSubmit={e=>{e.preventDefault();void cancel(row.id)}}><label className="check-label"><input type="checkbox" required disabled={busy}/> I reviewed the concern and will cancel this entire preview. All active proposals are annulled, copy reservations are released, and accepted bid history remains.</label><div className="actions"><button className="button red" disabled={busy}>Confirm cancellation <Gavel size={16}/></button><button type="button" className="button outline" disabled={busy} onClick={()=>setConfirm(null)}>Keep preview <X size={16}/></button></div></form>:<button className="button outline" disabled={busy||loading} onClick={()=>setConfirm(row.id)}>Review cancellation <Gavel size={16}/></button>)}
  </article>)}{!loading&&!rows.length&&!error&&<div className="empty-state"><Gavel size={30}/><h2>NO PREVIEWS FOUND.</h2><p>Use the exact listing ID from the collector's support request.</p></div>}
 </section>;
}
