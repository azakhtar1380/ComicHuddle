'use client';
// The profile's Collection tab: the only collection page. Header with the count (and "Add comics" for the owner),
// search, chips (All · Keys · Graded · For trade), a 2-column grid. Owners also get a ⋯ menu per comic, Select
// mode for bulk actions, the "Show my collection" setting and a private estimate line. Visitors get a read-only grid.
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {CheckSquare,Lock,MoreHorizontal,Pencil,Plus,Repeat2,Search,ShoppingBag,Trash2,X} from 'lucide-react';
import type {Vault} from '../../lib/vault';
import type {CollectionCopy,CollectionVisibility} from '../../lib/profile-collection';
import HScroll from '../h-scroll';
import AddComicsSheet from './add-comics-sheet';
import './collection-tab.css';

export type CollectionChip='all'|'keys'|'graded'|'trade';
const plural=(n:number,one:string,many:string)=>`${n.toLocaleString('en-US')} ${n===1?one:many}`;
const money=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(c/100);
type OwnerProps={vault:Vault;commit:(v:Vault)=>Promise<boolean>;saving:boolean;listedIds:Set<string>;onEditCopy:(id:string)=>void;onSell:(ids:string[])=>void;onScan:()=>void};
type Props={handle:string;own:boolean;dmOpen:boolean;notice:(s:string)=>void;onIssue:(id:number)=>void;initialChip?:CollectionChip;owner?:OwnerProps};

export default function CollectionTab({handle,own,notice,onIssue,initialChip='all',owner}:Props){
 const ids=useId(),[copies,setCopies]=useState<CollectionCopy[]|null>(null),[visibility,setVisibility]=useState<CollectionVisibility>('keys'),[error,setError]=useState('');
 const [q,setQ]=useState(''),[chip,setChip]=useState<CollectionChip>(initialChip),[menu,setMenu]=useState<string|null>(null),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState<Set<string>>(new Set());
 const [adding,setAdding]=useState(false),[confirm,setConfirm]=useState<string[]|null>(null),[estimate,setEstimate]=useState<{lowCents:number;highCents:number;priced:number;total:number}|null>(null),[showEstimate,setShowEstimate]=useState(false);
 const menuRef=useRef<HTMLDivElement>(null);
 // Owners reload when their collection changes (add, edit, trade, remove).
 const signature=owner?owner.vault.books.map(b=>b.id+':'+b.grade+':'+(b.ownership?.format||'')).join(',')+'|'+owner.vault.tradeBookIds.join(','):'';
 useEffect(()=>{const c=new AbortController();void fetch(own?'/api/profile-collection?mine=1':'/api/profile-collection?handle='+encodeURIComponent(handle),{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d}).then(d=>{setCopies(d.copies);setVisibility(d.visibility);setError('')}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error&&e.message?e.message:'This collection could not load.')});return()=>c.abort()},[handle,own,signature]);
 useEffect(()=>{if(!menu)return;const close=(e:PointerEvent)=>{if(!menuRef.current?.contains(e.target as Node))setMenu(null)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(null)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key)}},[menu]);
 const shown=useMemo(()=>{const term=q.trim().toLowerCase().replace('#','');return (copies||[]).filter(c=>(chip==='all'||(chip==='keys'&&!!c.keyNote)||(chip==='graded'&&c.graded)||(chip==='trade'&&c.forTrade))&&(!term||(c.title+' '+c.issue+' '+(c.year||'')).toLowerCase().replace('#','').includes(term)))},[copies,q,chip]);
 const total=copies?.length||0;
 async function save(next:Vault,message:string){if(!owner)return false;const ok=await owner.commit(next);if(ok)notice(message);return ok}
 async function setTrade(bookIds:string[],on:boolean){if(!owner)return;const v=owner.vault;const next=on?[...new Set([...v.tradeBookIds,...bookIds])]:v.tradeBookIds.filter(id=>!bookIds.includes(id));if(await save({...v,tradeBookIds:next},on?(bookIds.length>1?plural(bookIds.length,'comic','comics')+' marked for trade.':'Marked for trade.'):'Taken off your trade list.'))setSelected(new Set())}
 async function remove(bookIds:string[]){if(!owner)return;const blocked=bookIds.filter(id=>owner.listedIds.has(id));if(blocked.length){notice('That comic is listed for sale. Take down the listing first.');return}const v=owner.vault;if(await save({...v,books:v.books.filter(b=>!bookIds.includes(b.id)),tradeBookIds:v.tradeBookIds.filter(id=>!bookIds.includes(id))},bookIds.length>1?plural(bookIds.length,'comic','comics')+' removed.':'Comic removed.')){setSelected(new Set());setSelecting(false)}}
 async function setVis(v:CollectionVisibility){const before=visibility;setVisibility(v);try{const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({shopWindow:v==='everyone'?'open':v==='keys'?'window':'closed'})});if(!r.ok)throw Error()}catch{setVisibility(before);notice('That didn’t save. Try again.')}}
 async function reveal(){if(showEstimate){setShowEstimate(false);return}setShowEstimate(true);if(estimate)return;try{const r=await fetch('/api/profile-collection?mine=1&estimate=1',{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(r.ok)setEstimate(d.estimate)}catch{/* stays hidden */}}
 const toggle=(id:string)=>setSelected(p=>{const n=new Set(p);if(n.has(id))n.delete(id);else n.add(id);return n});
 if(error)return <p className="ct-note" role="alert">{error}</p>;
 if(!copies)return <p className="ct-note" role="status">Loading the collection…</p>;
 if(!own&&visibility==='me')return <p className="ct-empty">This collector keeps their collection private.</p>;
 const chips:[CollectionChip,string][]=[['all','All'],['keys','Keys'],['graded','Graded'],...(own||copies.some(c=>c.forTrade)?[['trade','For trade'] as [CollectionChip,string]]:[])];
 return <section className="ct" aria-labelledby={ids+'-h'}>
  <div className="ct-head">
   <h2 id={ids+'-h'}>{plural(total,'comic','comics')}{!own&&visibility==='keys'?<small> · keys only</small>:null}</h2>
   {own&&<button type="button" className="ds-btn ds-btn-primary ct-add" onClick={()=>setAdding(true)}><Plus size={18} aria-hidden="true"/> Add comics</button>}
  </div>
  {own&&<fieldset className="ct-vis"><legend>Show my collection</legend>
   {([['everyone','Everyone'],['keys','Keys only'],['me','Only me']] as const).map(([v,label])=><label key={v} className={visibility===v?'is-on':''}><input type="radio" name={ids+'-vis'} checked={visibility===v} onChange={()=>void setVis(v)}/>{label}</label>)}
  </fieldset>}
  {total>0&&<>
   <label className="ct-search"><Search size={18} aria-hidden="true"/><span className="sr-only">{own?'Search your comics':'Search these comics'}</span><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder={own?'Search your comics':'Search these comics'}/>{q&&<button type="button" aria-label="Clear search" onClick={()=>setQ('')}><X size={16} aria-hidden="true"/></button>}</label>
   <HScroll className="ct-chips" role="toolbar" aria-label="Filter comics">{chips.map(([id,label])=><button key={id} type="button" aria-pressed={chip===id} onClick={()=>setChip(id)}>{label}</button>)}</HScroll>
   {own&&<div className="ct-tools"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setSelected(new Set())}}><CheckSquare size={16} aria-hidden="true"/> {selecting?'Done':'Select'}</button>
    <button type="button" className="ct-estimate" aria-expanded={showEstimate} onClick={()=>void reveal()}><Lock size={13} aria-hidden="true"/> {showEstimate?(estimate?(estimate.priced?<>Est. value: <b>{money(estimate.lowCents)}–{money(estimate.highCents)}</b> ({estimate.priced} of {estimate.total})</>:'Est. value: no estimates yet'):'Loading…'):'Est. value: tap to show (only you)'}</button></div>}
   {selecting&&<div className="ct-bulk" role="region" aria-label="Bulk actions"><strong>{selected.size} selected</strong>
    <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!selected.size||owner?.saving} onClick={()=>void setTrade([...selected],![...selected].every(id=>owner?.vault.tradeBookIds.includes(id)))}><Repeat2 size={16} aria-hidden="true"/> {selected.size&&[...selected].every(id=>owner?.vault.tradeBookIds.includes(id))?'Remove from trade':'Mark for trade'}</button>
    <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm ct-danger" disabled={!selected.size||owner?.saving} onClick={()=>setConfirm([...selected])}><Trash2 size={16} aria-hidden="true"/> Remove</button></div>}
  </>}
  {!total?<div className="ct-empty">{own?<><p>No comics yet</p><button type="button" className="ds-btn ds-btn-primary" onClick={()=>setAdding(true)}><Plus size={18} aria-hidden="true"/> Add comics</button></>:<p>Nothing to show yet</p>}</div>
  :!shown.length?<p className="ct-empty">No comics match.</p>
  :<ul className="ct-grid">{shown.map(c=>{const isSel=selected.has(c.id),open=()=>selecting?toggle(c.id):c.directoryIssueId!==null?onIssue(c.directoryIssueId):own?owner?.onEditCopy(c.id):undefined;
   return <li key={c.id} className={'ct-card'+(isSel?' is-selected':'')}>
    <button type="button" className="ct-open" onClick={open} aria-pressed={selecting?isSel:undefined} aria-label={(selecting?'Select ':'')+c.title+' '+c.issue}>
     <span className="ct-cover">{c.cover?<img src={c.cover} alt="" loading="lazy" decoding="async"/>:<span className="ct-cover-empty" aria-hidden="true">{c.title.slice(0,1)}</span>}{selecting&&<span className="ct-check" aria-hidden="true">{isSel?'✓':''}</span>}</span>
     <strong className="ct-title">{c.title} {c.issue}</strong>
     {c.year&&<small className="ct-year">{c.year}</small>}
     {c.keyNote&&<small className="ct-key">{c.keyNote}</small>}
     <span className="ct-pills"><span className="ct-pill">{c.grade}</span>{c.forTrade&&<span className="ct-pill ct-pill-trade">For trade</span>}</span>
    </button>
    {own&&owner&&!selecting&&<div className="ct-menu" ref={menu===c.id?menuRef:undefined}>
     <button type="button" className="ct-menu-btn" aria-label={'Options for '+c.title+' '+c.issue} aria-haspopup="menu" aria-expanded={menu===c.id} onClick={()=>setMenu(menu===c.id?null:c.id)}><MoreHorizontal size={20} aria-hidden="true"/></button>
     {menu===c.id&&<div className="ct-menu-list" role="menu">
      <button role="menuitem" type="button" onClick={()=>{setMenu(null);owner.onEditCopy(c.id)}}><Pencil size={16} aria-hidden="true"/> Edit copy</button>
      <button role="menuitem" type="button" disabled={owner.saving} onClick={()=>{setMenu(null);void setTrade([c.id],!c.forTrade)}}><Repeat2 size={16} aria-hidden="true"/> {c.forTrade?'Remove from trade':'Mark for trade'}</button>
      <button role="menuitem" type="button" disabled={owner.listedIds.has(c.id)} onClick={()=>{setMenu(null);owner.onSell([c.id])}}><ShoppingBag size={16} aria-hidden="true"/> {owner.listedIds.has(c.id)?'Already listed':'Sell'}</button>
      <button role="menuitem" type="button" className="ct-danger" disabled={owner.saving} onClick={()=>{setMenu(null);setConfirm([c.id])}}><Trash2 size={16} aria-hidden="true"/> Remove</button>
     </div>}
    </div>}
   </li>})}</ul>}
  {confirm&&<div className="ct-confirm" role="alertdialog" aria-labelledby={ids+'-confirm'}><p id={ids+'-confirm'}>Remove {confirm.length>1?plural(confirm.length,'comic','comics'):'this comic'} from your collection?</p><div className="ds-actions"><button type="button" className="ds-btn ds-btn-primary ds-btn-sm" onClick={()=>{const list=confirm;setConfirm(null);void remove(list)}}>Remove</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setConfirm(null)}>Keep</button></div></div>}
  {adding&&owner&&<AddComicsSheet vault={owner.vault} commit={owner.commit} onClose={()=>setAdding(false)} onScan={()=>{setAdding(false);owner.onScan()}} notice={notice}/>}
 </section>;
}
