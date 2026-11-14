'use client';
// Self-contained order feedback UI (eBay model). Data: /api/social/feedback.
//  <LeaveFeedback orderId="..."/>          for the Orders page (buyer or seller of that order)
//  <SellerFeedback profileId="..." />       for a seller's public profile / listing seller block
//  <SellerFeedback profileId="..." compact/> one-line "98.7% positive (152)"
import {useCallback,useEffect,useState} from 'react';
import {MessageSquareReply,Minus,Star,ThumbsDown,ThumbsUp} from 'lucide-react';
import './community-feedback.css';

type Rating='positive'|'neutral'|'negative';
type Entry={id:string;rating:Rating;itemAsDescribed:number|null;communication:number|null;shippingSpeed:number|null;comment:string;reply:string|null;replyAt:string|null;createdAt:string};
type Status={role:'buyer'|'seller';completedAt:string|null;deadline:string|null;editableUntil:string|null;canLeave:boolean;canEdit:boolean;reason:string|null;mine:(Entry&{updatedAt:string})|null;received:(Entry&{canReply:boolean})|null};
type Summary={positive:number;neutral:number;negative:number;count:number;percentPositive:number|null;lifetimeCount:number;positiveAsBuyer:number;windowDays:number;detailed:{itemAsDescribed:number|null;communication:number|null;shippingSpeed:number|null};recent:(Entry&{buyer:string})[]};

const when=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const ratingLabel:Record<Rating,string>={positive:'Positive',neutral:'Neutral',negative:'Negative'};
const RatingIcon=({rating,size=16}:{rating:Rating;size?:number})=>rating==='positive'?<ThumbsUp size={size} aria-hidden="true"/>:rating==='negative'?<ThumbsDown size={size} aria-hidden="true"/>:<Minus size={size} aria-hidden="true"/>;
const reasons:Record<string,string>={self:'You can’t leave feedback for yourself.',not_completed:'Feedback opens once the order is delivered or picked up.',window_closed:'The 60-day window to leave feedback has closed.',locked:'Feedback can no longer be changed (30-day limit).'};
async function api<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});const body=await r.json().catch(()=>({}));if(!r.ok)throw Error((body as {error?:string}).error||'Feedback is unavailable right now.');return body as T}

export function feedbackLine(s:Pick<Summary,'percentPositive'|'count'>){return s.percentPositive===null?'No feedback yet':`${s.percentPositive}% positive (${s.count.toLocaleString('en-US')})`}

function Stars({label,name,value,onChange}:{label:string;name:string;value:number;onChange:(n:number)=>void}){
 return <fieldset className="fb-stars"><legend>{label} <span className="fb-optional">(optional)</span></legend><div>{[1,2,3,4,5].map(n=><label key={n} title={n+' of 5'}><input type="radio" name={name} value={n} checked={value===n} onChange={()=>onChange(n)}/><Star size={22} aria-hidden="true" fill={n<=value?'currentColor':'none'}/><span className="fb-sr">{n} {n===1?'star':'stars'}</span></label>)}{value>0&&<button type="button" className="fb-clear" onClick={()=>onChange(0)}>Clear</button>}</div></fieldset>;
}

export function LeaveFeedback({orderId,onSaved}:{orderId:string;onSaved?:()=>void}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[saved,setSaved]=useState('');
 const [rating,setRating]=useState<Rating|''>(''),[iad,setIad]=useState(0),[comm,setComm]=useState(0),[ship,setShip]=useState(0),[comment,setComment]=useState(''),[reply,setReply]=useState('');
 const load=useCallback(async()=>{try{const s=await api<Status>('/api/social/feedback?order='+encodeURIComponent(orderId));setStatus(s);setError('');if(s.mine){setRating(s.mine.rating);setIad(s.mine.itemAsDescribed||0);setComm(s.mine.communication||0);setShip(s.mine.shippingSpeed||0);setComment(s.mine.comment)}else if(s.role==='seller')setRating('positive')}catch(e){setError(e instanceof Error?e.message:'Feedback is unavailable right now.')}},[orderId]);
 useEffect(()=>{void load()},[load]);
 if(error&&!status)return <p className="fb-note" role="status">{error}</p>;
 if(!status)return <p className="fb-note" role="status">Loading feedback…</p>;
 const seller=status.role==='seller',editable=status.canLeave||status.canEdit;
 async function submit(e:React.FormEvent){e.preventDefault();if(!rating||busy)return;setBusy(true);setError('');setSaved('');
  try{const s=await api<Status>('/api/social/feedback',{method:'POST',body:JSON.stringify({action:'leave',orderId,rating,comment,...(seller?{}:{itemAsDescribed:iad||null,communication:comm||null,shippingSpeed:ship||null})})});setStatus(s);setOpen(false);setSaved(status!.mine?'Your feedback was updated.':'Thanks! Your feedback is posted.');onSaved?.()}
  catch(err){setError(err instanceof Error?err.message:'Feedback could not be saved.')}finally{setBusy(false)}}
 async function sendReply(e:React.FormEvent){e.preventDefault();if(!status?.received||busy)return;setBusy(true);setError('');
  try{await api('/api/social/feedback',{method:'POST',body:JSON.stringify({action:'reply',feedbackId:status.received.id,reply})});setReply('');setSaved('Your reply is posted.');await load()}
  catch(err){setError(err instanceof Error?err.message:'Reply could not be saved.')}finally{setBusy(false)}}
 return <section className="fb-leave" aria-label="Order feedback">
  {status.mine&&!open&&<div className="fb-mine"><span className={'fb-pill fb-'+status.mine.rating}><RatingIcon rating={status.mine.rating}/> {ratingLabel[status.mine.rating]}</span><span>{seller?'Your feedback for the buyer':'Your feedback for the seller'}{status.mine.comment&&<>: “{status.mine.comment}”</>}</span>{status.canEdit&&<button type="button" className="inline-button" onClick={()=>setOpen(true)}>Edit</button>}</div>}
  {!status.mine&&!open&&(status.canLeave?<button type="button" className="button red small-button" onClick={()=>setOpen(true)}><Star size={15} aria-hidden="true"/> {seller?'Leave feedback for buyer':'Leave feedback'}</button>:<p className="fb-note">{reasons[status.reason||'']||'Feedback isn’t available for this order.'}</p>)}
  {open&&editable&&<form className="fb-form" onSubmit={e=>void submit(e)}>
   <h4>{seller?'Feedback for the buyer':'How was this purchase?'}</h4>
   {seller?<p className="fb-note">Like eBay, sellers can leave positive feedback for buyers.</p>
   :<fieldset className="fb-choice"><legend>Overall</legend><div>{(['positive','neutral','negative'] as Rating[]).map(r=><label key={r} className={'fb-'+r+(rating===r?' selected':'')}><input type="radio" name="rating" value={r} required checked={rating===r} onChange={()=>setRating(r)}/><RatingIcon rating={r} size={18}/> {ratingLabel[r]}</label>)}</div></fieldset>}
   {!seller&&<div className="fb-detail"><Stars label="Item as described" name="iad" value={iad} onChange={setIad}/><Stars label="Communication" name="comm" value={comm} onChange={setComm}/><Stars label="Shipping speed" name="ship" value={ship} onChange={setShip}/></div>}
   <label className="fb-comment">Comment <span className="fb-optional">(optional, public)</span><textarea value={comment} maxLength={500} onChange={e=>setComment(e.target.value)} placeholder={seller?'Great buyer, fast payment.':'What went well, or what could be better?'}/><small>{500-comment.length} characters left · Don’t include addresses or order numbers.</small></label>
   <div className="fb-actions"><button className="button red small-button" disabled={busy||!rating}>{busy?'Saving…':status.mine?'Update feedback':'Post feedback'}</button><button type="button" className="inline-button" onClick={()=>setOpen(false)}>Cancel</button></div>
   <p className="fb-note">You can edit feedback for 30 days after posting.</p>
  </form>}
  {status.received&&<div className="fb-received"><p><span className={'fb-pill fb-'+status.received.rating}><RatingIcon rating={status.received.rating}/> {ratingLabel[status.received.rating]}</span> {seller?'from the buyer':'from the seller'}{status.received.comment&&<>: “{status.received.comment}”</>}</p>
   {status.received.reply&&<p className="fb-reply"><MessageSquareReply size={14} aria-hidden="true"/> Your reply: {status.received.reply}</p>}
   {status.received.canReply&&<form className="fb-reply-form" onSubmit={e=>void sendReply(e)}><label>Reply publicly (once)<textarea value={reply} maxLength={500} required onChange={e=>setReply(e.target.value)}/></label><button className="button outline small-button" disabled={busy||!reply.trim()}>Post reply</button></form>}
  </div>}
  {saved&&<p className="fb-success" role="status">{saved}</p>}
  {error&&<p className="fb-error" role="alert">{error}</p>}
 </section>;
}

export function SellerFeedback({profileId,compact=false,limit=5}:{profileId:string;compact?:boolean;limit?:number}){
 const [summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState('');
 useEffect(()=>{let keep=true;setSummary(null);void api<Summary>('/api/social/feedback?'+new URLSearchParams({profile:profileId,limit:String(limit)})).then(s=>{if(keep)setSummary(s)}).catch(e=>{if(keep)setError(e instanceof Error?e.message:'')});return()=>{keep=false}},[profileId,limit]);
 if(error)return null;
 if(!summary)return compact?<span className="fb-compact">…</span>:<p className="fb-note" role="status">Loading feedback…</p>;
 if(compact)return <span className="fb-compact" title={`Past 12 months: ${summary.positive} positive, ${summary.neutral} neutral, ${summary.negative} negative`}><ThumbsUp size={13} aria-hidden="true"/> {feedbackLine(summary)}</span>;
 if(!summary.lifetimeCount&&!summary.positiveAsBuyer)return <p className="fb-note fb-empty"><ThumbsUp size={13} aria-hidden="true"/> No marketplace feedback yet.</p>;
 const d=summary.detailed;
 return <section className="fb-summary" aria-label="Seller feedback">
  <div className="fb-head"><h4>Seller feedback</h4><strong>{feedbackLine(summary)}</strong></div>
  {summary.count>0&&<><ul className="fb-counts" aria-label="Past 12 months"><li className="fb-positive"><ThumbsUp size={14} aria-hidden="true"/> {summary.positive} positive</li><li className="fb-neutral"><Minus size={14} aria-hidden="true"/> {summary.neutral} neutral</li><li className="fb-negative"><ThumbsDown size={14} aria-hidden="true"/> {summary.negative} negative</li></ul>
   {(d.itemAsDescribed!==null||d.communication!==null||d.shippingSpeed!==null)&&<dl className="fb-dsr">{([['Item as described',d.itemAsDescribed],['Communication',d.communication],['Shipping speed',d.shippingSpeed]] as const).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v===null?'—':v.toFixed(1)+' / 5'}</dd></div>)}</dl>}</>}
  <p className="fb-note">Percentage = positive ÷ (positive + negative) over the past 12 months, from buyers with completed orders.{summary.positiveAsBuyer>0?` Also ${summary.positiveAsBuyer} positive as a buyer.`:''}</p>
  {summary.recent.length>0&&<ul className="fb-list">{summary.recent.map(f=><li key={f.id}><div className="fb-row"><span className={'fb-pill fb-'+f.rating}><RatingIcon rating={f.rating}/> {ratingLabel[f.rating]}</span><small>{f.buyer} · {when(f.createdAt)}</small></div>{f.comment&&<p>{f.comment}</p>}{f.reply&&<p className="fb-reply"><MessageSquareReply size={14} aria-hidden="true"/> Seller reply: {f.reply}</p>}</li>)}</ul>}
 </section>;
}
