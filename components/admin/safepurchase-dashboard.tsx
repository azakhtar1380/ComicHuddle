'use client';
// Admin SafePurchase dashboard (/admin/safepurchase). The page gates on admin server-side; every call here
// goes to /api/admin/safepurchase, which checks admin again and logs each action.
import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Search,RefreshCw,X,Upload} from 'lucide-react';
import {SafePurchaseTimelineView} from '../safepurchase-timeline';
import {SAFEPURCHASE_STEPS,STEP_LABELS,type SafePurchaseOutcome,type SafePurchaseStep,type SafePurchaseTimeline} from '../../lib/safepurchase-steps';
import './admin.css';

type Summary={orderId:string;orderNumber:string;title:string;buyer:{profileId:string;name:string|null};seller:{profileId:string;name:string|null};totalCents:number;itemAmountCents:number;status:string;currentStep:SafePurchaseStep|null;currentLabel:string;outcome:SafePurchaseOutcome;createdAt:string;sandbox:boolean;fulfillment:'shipping'|'pickup'};
type ListData={orders:Summary[];total:number;offset:number;hasMore:boolean;counts:Record<string,number>;truncated:boolean;auditReady:boolean};
type Actions={receive:boolean;check:boolean;checkPartialAllowed:boolean;shipToBuyer:boolean;handoff:boolean;refund:boolean;returnShipment:boolean;release:boolean};
type Audit={id:string;adminName:string|null;founder:boolean;action:string;detail:Record<string,unknown>;createdAt:string};
type Detail={order:{orderId:string;orderNumber:string;title:string;status:string;sandbox:boolean;fulfillment:string;createdAt:string;totalCents:number;itemAmountCents:number;itemCount:number;buyer:{name:string|null};seller:{name:string|null}};timeline:SafePurchaseTimeline;ownOrder:boolean;actions:Actions;events:{type:string;note:string|null;createdAt:string}[];audit:Audit[];auditReady:boolean};

const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const day=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const stamp=(iso:string)=>new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const FILTERS:{id:string;label:string}[]=[{id:'all',label:'All'},...SAFEPURCHASE_STEPS.map(step=>({id:step,label:STEP_LABELS[step]})),{id:'problems',label:'Problems'}];
const CARRIERS=['USPS','UPS','FedEx','DHL'];

async function call<T>(input:string,init?:RequestInit):Promise<T>{
 const response=await fetch(input,{credentials:'same-origin',cache:'no-store',...init,headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(typeof body.error==='string'?body.error:'That didn’t work. Refresh and try again.');
 return body as T;
}

/** Uploads chosen photos through the existing /api/media route; returns their ids. */
function PhotoPicker({value,onChange}:{value:string[];onChange:(ids:string[])=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function pick(files:FileList|null){
  if(!files?.length)return;setBusy(true);setError('');const ids=[...value];
  try{for(const file of Array.from(files).slice(0,8-ids.length)){const response=await fetch('/api/media',{method:'POST',credentials:'same-origin',body:file});const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'Photo upload failed.');ids.push(body.id)}}
  catch(problem){setError(problem instanceof Error?problem.message:'Photo upload failed.')}
  finally{onChange(ids);setBusy(false)}
 }
 return <div className="adm-photos">
  <label className="ds-btn ds-btn-secondary ds-btn-sm adm-upload"><Upload size={16} aria-hidden="true"/> {busy?'Uploading…':'Add photos'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy||value.length>=8} onChange={event=>{void pick(event.currentTarget.files);event.currentTarget.value=''}}/></label>
  {value.length>0&&<span>{value.length} photo{value.length===1?'':'s'} attached <button type="button" className="adm-link" onClick={()=>onChange([])}>Remove</button></span>}
  {error&&<span role="alert" className="ds-error">{error}</span>}
 </div>;
}

function ActionForm({title,children,submit,busy,onSubmit,danger=false}:{title:string;children?:ReactNode;submit:string;busy:boolean;onSubmit:(form:FormData)=>void;danger?:boolean}){
 return <form className={'adm-action'+(danger?' is-danger':'')} onSubmit={(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();onSubmit(new FormData(event.currentTarget))}}>
  <h4>{title}</h4>{children}
  <button className={'ds-btn ds-btn-sm '+(danger?'ds-btn-primary':'ds-btn-dark')} disabled={busy}>{busy?'Saving…':submit}</button>
 </form>;
}

function OrderPanel({orderId,onClose,onChanged}:{orderId:string;onClose:()=>void;onChanged:()=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[photos,setPhotos]=useState<string[]>([]),[result,setResult]=useState('passed');
 const requestIds=useRef<Record<string,string>>({});
 const rid=(key:string)=>requestIds.current[key]||=crypto.randomUUID();
 const load=useCallback(()=>call<Detail>('/api/admin/safepurchase?order='+encodeURIComponent(orderId)).then(value=>{setDetail(value);setError('')}).catch(problem=>setError(problem.message)),[orderId]);
 useEffect(()=>{void load()},[load]);
 async function act(body:Record<string,unknown>,key?:string){
  if(busy)return;setBusy(true);setError('');setDone('');
  try{const response=await call<{detail:Detail}>('/api/admin/safepurchase',{method:'POST',body:JSON.stringify({orderId,...body})});setDetail(d=>d?{...response.detail,audit:d.audit}:response.detail);if(key)delete requestIds.current[key];setPhotos([]);setDone('Saved. The buyer and seller were notified where it applies.');void load();onChanged()}
  catch(problem){setError(problem instanceof Error?problem.message:'That didn’t work.')}
  finally{setBusy(false)}
 }
 const note=(form:FormData)=>String(form.get('note')||'').trim();
 const a=detail?.actions;
 return <aside className="adm-panel" aria-label={'Order '+(detail?.order.orderNumber||'')}>
  <div className="adm-panel-head"><h2>{detail?<>Order {detail.order.orderNumber}</>:'Order'}</h2><button type="button" className="adm-icon" onClick={onClose} aria-label="Close order"><X size={18} aria-hidden="true"/></button></div>
  {error&&<p role="alert" className="ds-error">{error}</p>}
  {done&&<p role="status" className="adm-ok">{done}</p>}
  {!detail&&!error&&<p role="status">Loading…</p>}
  {detail&&<>
   <dl className="adm-facts">
    <div><dt>Comic</dt><dd>{detail.order.title}{detail.order.itemCount>1?` (${detail.order.itemCount} books)`:''}</dd></div>
    <div><dt>Price</dt><dd>{usd(detail.order.itemAmountCents)} <small>· total paid {usd(detail.order.totalCents)}</small></dd></div>
    <div><dt>Buyer</dt><dd>{detail.order.buyer.name||'Not listed'}</dd></div>
    <div><dt>Seller</dt><dd>{detail.order.seller.name||'Not listed'}</dd></div>
    <div><dt>Order status</dt><dd><code>{detail.order.status}</code>{detail.order.sandbox&&<span className="adm-test">Test</span>}</dd></div>
    <div><dt>Placed</dt><dd>{day(detail.order.createdAt)}</dd></div>
   </dl>
   {detail.ownOrder&&<p className="adm-warn" role="note">You bought or sold this order, so you can’t change it. Ask another admin.</p>}
   <SafePurchaseTimelineView timeline={detail.timeline} heading={false}/>
   <p className="adm-hint">Seller shipped comes from the seller’s tracking. Delivered comes from the carrier (EasyPost). Done comes from the seller payout. You can add notes and photos to any step.</p>
   {!detail.ownOrder&&a&&<div className="adm-actions">
    {a.receive&&<ActionForm title="Mark received" submit="Mark received" busy={busy} onSubmit={form=>void act({action:'receive',note:note(form),photoIds:photos})}>
     <textarea name="note" maxLength={1000} placeholder="Note for buyer and seller (optional)" rows={2}/><PhotoPicker value={photos} onChange={setPhotos}/>
    </ActionForm>}
    {a.check&&<ActionForm title="Record the check" submit="Save check result" busy={busy} danger={result!=='passed'} onSubmit={form=>{const reasons=String(form.get('reasons')||'').split('\n').map(v=>v.trim()).filter(Boolean);void act({action:'check',result,reasons,failedItems:Number(form.get('failedItems')||0),requestId:rid('check'),note:note(form),photoIds:photos},'check')}}>
     <fieldset className="adm-radio"><legend>Result</legend>
      <label><input type="radio" name="result" value="passed" checked={result==='passed'} onChange={()=>setResult('passed')}/> Passed: right issue, printing and condition</label>
      <label><input type="radio" name="result" value="failed" checked={result==='failed'} onChange={()=>setResult('failed')}/> Failed: refund the buyer, return to the seller</label>
      {a.checkPartialAllowed&&<label><input type="radio" name="result" value="partial" checked={result==='partial'} onChange={()=>setResult('partial')}/> Part of the collection failed</label>}
     </fieldset>
     {result!=='passed'&&<label className="ds-field"><span>What didn’t match (one per line, shared with buyer and seller)</span><textarea name="reasons" rows={3} required maxLength={4000}/></label>}
     {result==='partial'&&<label className="ds-field"><span>Books that failed</span><input name="failedItems" type="number" min={1} required/></label>}
     <textarea name="note" maxLength={1000} placeholder="Note for buyer and seller (optional)" rows={2}/><PhotoPicker value={photos} onChange={setPhotos}/>
    </ActionForm>}
    {a.shipToBuyer&&<ActionForm title="Ship to buyer" submit="Save tracking" busy={busy} onSubmit={form=>void act({action:'ship_to_buyer',carrier:String(form.get('carrier')),trackingNumber:String(form.get('trackingNumber')||'').trim(),note:note(form),photoIds:photos})}>
     <div className="adm-row"><select name="carrier" aria-label="Carrier">{CARRIERS.map(c=><option key={c}>{c}</option>)}</select><input name="trackingNumber" required minLength={6} maxLength={60} placeholder="Tracking number" aria-label="Tracking number"/></div>
     <textarea name="note" maxLength={1000} placeholder="Note (optional)" rows={2}/><PhotoPicker value={photos} onChange={setPhotos}/>
    </ActionForm>}
    {a.handoff&&<ActionForm title="Buyer picked up here" submit="Confirm pickup" busy={busy} onSubmit={form=>void act({action:'handoff',code:String(form.get('code')||'').trim(),note:note(form)})}>
     <input name="code" inputMode="numeric" pattern="\d{6}" required placeholder="Buyer’s 6-digit code" aria-label="Buyer’s pickup code"/><textarea name="note" maxLength={1000} placeholder="Note (optional)" rows={2}/>
    </ActionForm>}
    {a.returnShipment&&<ActionForm title="Return to seller" submit="Save return tracking" busy={busy} onSubmit={form=>void act({action:'return_shipped',carrier:String(form.get('carrier')),trackingNumber:String(form.get('trackingNumber')||'').trim(),note:note(form),photoIds:photos})}>
     <div className="adm-row"><select name="carrier" aria-label="Carrier">{CARRIERS.map(c=><option key={c}>{c}</option>)}</select><input name="trackingNumber" required minLength={6} maxLength={60} placeholder="Return tracking number" aria-label="Return tracking number"/></div>
     <textarea name="note" maxLength={1000} placeholder="Note (optional)" rows={2}/>
    </ActionForm>}
    {a.refund&&<ActionForm title="Refund the buyer" submit="Start full refund" busy={busy} danger onSubmit={form=>{if(!window.confirm('Start a full refund to the buyer? This can’t be undone.'))return;void act({action:'refund',requestId:rid('refund'),...(form.get('approveIssue')?{approveIssue:true}:{}),note:note(form)},'refund')}}>
     <label className="adm-check"><input type="checkbox" name="approveIssue"/> Resolves the buyer’s open problem report</label>
     <textarea name="note" maxLength={1000} placeholder="Why (admins only)" rows={2}/>
    </ActionForm>}
    {a.release&&<ActionForm title="Pay the seller" submit="Release payout" busy={busy} onSubmit={()=>{if(!window.confirm('Release the seller payout?'))return;void act({action:'release',requestId:rid('release')},'release')}}><p className="adm-hint">Refused while seller payouts are switched off.</p></ActionForm>}
    <ActionForm title="Add a note" submit="Add note" busy={busy} onSubmit={form=>void act({action:'note',step:String(form.get('step')),internal:form.get('internal')==='on',note:note(form),photoIds:photos})}>
     <div className="adm-row"><select name="step" aria-label="Step" defaultValue={detail.timeline.currentStep||'checked'}>{SAFEPURCHASE_STEPS.map(s=><option key={s} value={s}>{STEP_LABELS[s]}</option>)}</select><label className="adm-check"><input type="checkbox" name="internal" defaultChecked/> Admins only</label></div>
     <textarea name="note" required maxLength={1000} placeholder="Note" rows={2}/><PhotoPicker value={photos} onChange={setPhotos}/>
    </ActionForm>
   </div>}
   <details className="adm-more"><summary>Order events ({detail.events.length})</summary><ul>{detail.events.map((e,i)=><li key={i}><code>{e.type}</code> {e.note} <small>{stamp(e.createdAt)}</small></li>)}</ul></details>
   <details className="adm-more" open={detail.audit.length>0}><summary>Admin log for this order ({detail.audit.length})</summary>{!detail.auditReady&&<p className="adm-warn">The audit log needs migration 040.</p>}<ul>{detail.audit.map(e=><li key={e.id}><b>{e.adminName||'Admin'}</b>{e.founder?' (Founder)':''} · {e.action.replace('safepurchase.','')} {e.detail.ok===false?<span className="ds-error">refused: {String(e.detail.error||'')}</span>:null} <small>{stamp(e.createdAt)}</small></li>)}</ul></details>
  </>}
 </aside>;
}

export default function SafePurchaseDashboard(){
 const [step,setStep]=useState('all'),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[data,setData]=useState<ListData|null>(null),[error,setError]=useState(''),[open,setOpen]=useState<string|null>(null),[tick,setTick]=useState(0);
 useEffect(()=>{
  let live=true;
  call<ListData>('/api/admin/safepurchase?'+new URLSearchParams({step,q:search,offset:String(offset)})).then(value=>{if(live){setData(value);setError('')}}).catch(problem=>{if(live)setError(problem.message)});
  return()=>{live=false};
 },[step,search,offset,tick]);
 return <div className="adm-dash">
  {data&&!data.auditReady&&<p className="adm-warn" role="note">Database migration 040 isn’t applied yet. You can view orders, but actions are refused until the audit log exists.</p>}
  <div className="adm-toolbar">
   <form role="search" className="adm-search" onSubmit={event=>{event.preventDefault();setOffset(0);setSearch(query.trim())}}>
    <Search size={18} aria-hidden="true"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Order number" aria-label="Search by order number" maxLength={40}/>
    {search&&<button type="button" className="adm-link" onClick={()=>{setQuery('');setSearch('');setOffset(0)}}>Clear</button>}
   </form>
   <button type="button" className="adm-icon" onClick={()=>setTick(t=>t+1)} aria-label="Refresh orders"><RefreshCw size={18} aria-hidden="true"/></button>
  </div>
  <div className="adm-filters" role="group" aria-label="Filter by step">{FILTERS.map(f=><button key={f.id} type="button" aria-pressed={step===f.id} onClick={()=>{setStep(f.id);setOffset(0)}}>{f.label}{data?<span>{data.counts[f.id]??0}</span>:null}</button>)}</div>
  {error&&<p role="alert" className="ds-error">{error}</p>}
  {!data&&!error&&<p role="status">Loading SafePurchase orders…</p>}
  {data&&(data.orders.length?<div className="adm-table-wrap"><table className="adm-table">
   <thead><tr><th scope="col">Order</th><th scope="col">Comic</th><th scope="col">Buyer</th><th scope="col">Seller</th><th scope="col">Price</th><th scope="col">Step</th><th scope="col">Placed</th></tr></thead>
   <tbody>{data.orders.map(o=><tr key={o.orderId} className={open===o.orderId?'is-open':''}>
    <td><button type="button" className="adm-link" onClick={()=>setOpen(o.orderId)}>{o.orderNumber}</button>{o.sandbox&&<span className="adm-test">Test</span>}</td>
    <td>{o.title}</td><td>{o.buyer.name||'Not listed'}</td><td>{o.seller.name||'Not listed'}</td><td>{usd(o.itemAmountCents)}</td>
    <td><span className={'adm-step is-'+o.outcome}>{o.currentLabel}</span></td><td>{day(o.createdAt)}</td>
   </tr>)}</tbody></table></div>:<p className="adm-empty">{search?'No SafePurchase order matches that number.':step==='all'?'No SafePurchase orders yet.':'No orders at this step.'}</p>)}
  {data&&(data.offset>0||data.hasMore)&&<div className="adm-pages"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={data.offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Newer</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!data.hasMore} onClick={()=>setOffset(v=>v+50)}>Older</button></div>}
  {data?.truncated&&<p className="adm-hint">Showing the latest 500 SafePurchase orders. Search by order number to find older ones.</p>}
  {open&&<OrderPanel key={open} orderId={open} onClose={()=>setOpen(null)} onChanged={()=>setTick(t=>t+1)}/>}
 </div>;
}
