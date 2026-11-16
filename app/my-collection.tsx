'use client';
// My collection: the heart of the app, styled as the member's own comic shop (components/collection/shop-front.tsx).
// The shop front links into the list views below. Collection · For trade (the Wants tab is hidden; its code and data are kept), with search, sort, filters,
// grid/list views, a ⋯ menu per comic, select mode for bulk actions, and a detail view of your copy.
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,Bookmark,Camera,Check,CheckSquare,ChevronDown,Download,Grid3X3,List,Lock,MoreHorizontal,Pencil,Plus,Repeat2,Search,ShoppingBag,SlidersHorizontal,Sparkles,Trash2,Upload,X} from 'lucide-react';
import type {Vault} from '../lib/vault';
import {catalog,type Issue} from '../lib/catalog';
import {bookIssue} from '../lib/trades';
import {listingDirectoryId,sharedProviderIdentity} from '../lib/shared-catalog';
import {ComicArt,Modal,uploadPhoto} from './network';
import PageHeader from '../components/page-header';
import {EmptyState,LoadingState} from '../components/states';
import {handOffBooksForSale} from '../lib/listing-draft';
import ShopFront,{type ShopData} from '../components/collection/shop-front';
import ComicPicker from './comic-picker';
import type {CollectionRun} from '../lib/collection-runs';
import type {ShopWindow} from '../lib/collection-shop';
import './my-collection.css';

type Book=Vault['books'][number];
export type CollectionTab='collection'|'wants'|'trade';
/** Owner decision 2026-11-15: hide the Wants tab. Saved wants stay in the database; flip this to bring the tab back. */
const SHOW_WANTS=false;
type Props={
 vault:Vault;loaded:boolean;saving:boolean;signedIn:boolean;status:string;
 commit:(vault:Vault)=>Promise<boolean>;gate:()=>boolean;notice:(message:string)=>void;
 tab:CollectionTab;onTab:(tab:CollectionTab)=>void;
 onAdd:()=>void;onScan:()=>void;onBrowse:()=>void;onOpenIssue:(id:number)=>void;onEdit:(bookId:string)=>void;
 onFindForSale:(issueId:number)=>void;onFeature:()=>void;onReconnect:()=>void;
 listedBookIds:Set<string>;featuredIds:string[];name?:string;since?:number;
};
const pageSize=60;
type Sort='recent'|'title'|'issue'|'year'|'publisher';
const sorts:[Sort,string][]=[['recent','Recently added'],['title','Title'],['issue','Issue #'],['year','Year'],['publisher','Publisher']];
const issueNumber=(value:string)=>{const n=parseFloat(value.replace(/^#/,''));return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER};
const money=(cents:string|null|undefined)=>cents==null?null:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents)/100);
const directoryId=(book:Book)=>{const curated=bookIssue(book);return curated?curated.id:listingDirectoryId(book)};
const graded=(book:Book)=>book.ownership?.format==='GRADED'||/^CGC\b/i.test(book.grade);
const titleCase=(value:string)=>value.toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
/** One filterable condition per copy, from what the collector recorded (never guessed). */
const conditionOf=(book:Book)=>{const o=book.ownership;
 if(o)return o.format==='GRADED'?(o.grade?'CGC '+o.grade:'CGC graded'):(o.rawCondition?titleCase(o.rawCondition):'Raw · not recorded');
 const cgc=/^CGC\s*(\d{1,2}(?:\.\d)?)/i.exec(book.grade.trim());if(cgc)return 'CGC '+cgc[1];
 return book.grade.trim().slice(0,40)||'Not recorded'};
const conditionRank=(label:string)=>{const cgc=/^CGC (\d+(?:\.\d)?)$/.exec(label);if(cgc)return -Number(cgc[1]);const raw=['Near Mint','Very Fine','Fine','Very Good','Good'].indexOf(label);return raw>=0?100+raw:200};

/** Directory records for saved comics (publisher, year, era, cover) so we can sort and filter. */
function useRecords(ids:number[]){
 const [records,setRecords]=useState<Record<number,Issue>>({}),[loading,setLoading]=useState(false);
 const key=ids.join(',');
 useEffect(()=>{
  const missing=ids.filter(id=>!catalog[id]&&sharedProviderIdentity(id)!==null&&!records[id]);
  if(!missing.length)return;
  const abort=new AbortController();setLoading(true);
  void (async()=>{for(let start=0;start<missing.length;start+=25){const response=await fetch('/api/catalog?ids='+missing.slice(start,start+25).join(','),{signal:abort.signal});if(!response.ok)throw Error();const body=await response.json() as {issues:Issue[]};setRecords(previous=>({...previous,...Object.fromEntries(body.issues.map(issue=>[issue.id,issue]))}))}})()
   .catch(()=>undefined).finally(()=>{if(!abort.signal.aborted)setLoading(false)});
  return()=>abort.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);
 const lookup=(id:number|null)=>id===null?undefined:catalog[id]||records[id];
 return {lookup,loading};
}

export default function MyCollection(p:Props){
 const {vault,saving}=p,tab:CollectionTab=p.tab==='wants'&&!SHOW_WANTS?'collection':p.tab;
 const [query,setQuery]=useState(''),[sort,setSort]=useState<Sort>('recent'),[view,setView]=useState<'grid'|'list'>('grid');
 const [publisher,setPublisher]=useState(''),[format,setFormat]=useState<''|'raw'|'graded'>(''),[condition,setCondition]=useState(''),[tradeOnly,setTradeOnly]=useState(false);
 const [sheet,setSheet]=useState(false),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState<Set<string>>(new Set());
 const [shown,setShown]=useState(pageSize);
 const [mode,setMode]=useState<'shop'|'list'>(p.tab==='trade'?'list':'shop'),[era,setEra]=useState(''),[character,setCharacter]=useState(''),[creator,setCreator]=useState(''),[keysOnly,setKeysOnly]=useState(false),[inRun,setInRun]=useState(false);
 const [shop,setShop]=useState<ShopData|null>(null),[shopBusy,setShopBusy]=useState(false),[runSetup,setRunSetup]=useState<{issue:Issue|null;from:string;to:string;title:string}|null>(null),[runError,setRunError]=useState('');
 const shopKey=p.signedIn&&p.loaded?vault.books.map(book=>book.id).join(','):'';
 useEffect(()=>{if(!shopKey&&!p.signedIn)return;const controller=new AbortController();const timer=setTimeout(()=>{void fetch('/api/collection-shop?mine=1',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<ShopData>}).then(d=>setShop(d)).catch(()=>undefined)},250);return()=>{clearTimeout(timer);controller.abort()}},[shopKey,p.signedIn]);
 async function shopPost(url:string,body:Record<string,unknown>){const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({})) as {error?:string;runs?:CollectionRun[];issueIds?:number[]};if(!r.ok)throw Error(d.error||'That didn’t save.');return d}
 async function setWindow(w:ShopWindow){if(!shop)return;const before=shop.window;setShop({...shop,window:w});setShopBusy(true);try{await shopPost('/api/profile-extras',{shopWindow:w});p.notice(w==='open'?'Your shop is open: visitors see every comic.':w==='window'?'Window display: visitors see your glass case, runs and favorites.':'Shop closed: your Collection tab is hidden.')}catch(e){setShop(s=>s&&{...s,window:before});p.notice(e instanceof Error?e.message:'That didn’t save.')}finally{setShopBusy(false)}}
 async function createRun(){if(!runSetup?.issue)return;const from=Number(runSetup.from),to=Number(runSetup.to);if(!Number.isInteger(from)||!Number.isInteger(to)||to<from){setRunError('Enter the first and last issue numbers.');return}setShopBusy(true);setRunError('');try{const d=await shopPost('/api/collection-runs',{action:'create',issueId:runSetup.issue.id,from,to,...(runSetup.title.trim()?{title:runSetup.title.trim()}:{})});setShop(s=>s&&{...s,runs:d.runs||s.runs});setRunSetup(null);p.notice('Run added to your wall.')}catch(e){setRunError(e instanceof Error?e.message:'That run didn’t save.')}finally{setShopBusy(false)}}
 async function deleteRun(id:string){setShopBusy(true);try{const d=await shopPost('/api/collection-runs',{action:'delete',id});setShop(s=>s&&{...s,runs:d.runs||s.runs.filter(r=>r.id!==id)})}catch(e){p.notice(e instanceof Error?e.message:'That run didn’t delete.')}finally{setShopBusy(false)}}
 async function addMissing(run:CollectionRun){setShopBusy(true);try{const d=await shopPost('/api/collection-runs',{action:'missing',id:run.id});const add=(d.issueIds||[]).filter(id=>!vault.wants.includes(id));if(!add.length){p.notice(d.issueIds?.length?'Those issues are already on your wishlist.':'We couldn’t match the missing issues in the Directory yet.');return}const next=[...vault.wants,...add].slice(0,1000);if(await p.commit({...vault,wants:next}))p.notice(add.length+' missing '+(add.length===1?'issue':'issues')+' added to your wishlist.')}catch(e){p.notice(e instanceof Error?e.message:'That didn’t work.')}finally{setShopBusy(false)}}
 const openList=(setup:()=>void)=>{setup();setMode('list');requestAnimationFrame(()=>window.scrollTo({top:0}))};
 const [menu,setMenu]=useState<string|null>(null),[detail,setDetail]=useState<string|null>(null),[confirmRemove,setConfirmRemove]=useState<string[]|null>(null),[photoBusy,setPhotoBusy]=useState('');
 const order=useMemo(()=>new Map(vault.books.map((book,index)=>[book.id,index])),[vault.books]);
 const ids=useMemo(()=>[...new Set([...vault.books.map(directoryId),...vault.wants].filter((id):id is number=>id!==null))],[vault.books,vault.wants]);
 const {lookup,loading}=useRecords(ids);
 const trade=useMemo(()=>new Set(vault.tradeBookIds),[vault.tradeBookIds]),featured=new Set(p.featuredIds);
 // Big collections render a page at a time; any search, filter or sort change starts from the top again.
 const listKey=[tab,query,publisher,format,condition,tradeOnly,sort,era,character,creator,keysOnly,inRun].join('|'),[shownKey,setShownKey]=useState(listKey);
 if(shownKey!==listKey){setShownKey(listKey);setShown(pageSize)}
 const publishers=useMemo(()=>[...new Set(vault.books.map(book=>lookup(directoryId(book))?.publisher).filter((v):v is string=>!!v))].sort(),[vault.books,lookup]);
 const keyed=(book:Book)=>{const id=directoryId(book);return id!==null&&!!shop?.keys[String(id)]};
 const runKeys=useMemo(()=>new Set((shop?.runs||[]).map(run=>(run.seriesName+'|'+run.publisher).toLowerCase())),[shop?.runs]);
 const inARun=(book:Book)=>{const r=lookup(directoryId(book));return !!r&&runKeys.has((r.title+'|'+r.publisher).toLowerCase())};
 const creatorsOf=(r:Issue|undefined)=>r?[r.writer,r.artist].filter((v):v is string=>!!v).flatMap(v=>v.split(/;|,/)).map(v=>v.trim()).filter(Boolean):[];
 const eras=useMemo(()=>[...new Set(vault.books.map(book=>lookup(directoryId(book))?.era).filter((v):v is string=>!!v))].sort(),[vault.books,lookup]);
 const characters=useMemo(()=>[...new Set(vault.books.flatMap(book=>lookup(directoryId(book))?.characters||[]))].sort().slice(0,300),[vault.books,lookup]);
 const creators=useMemo(()=>[...new Set(vault.books.flatMap(book=>creatorsOf(lookup(directoryId(book)))))].sort().slice(0,300),[vault.books,lookup]);
 const conditions=useMemo(()=>[...new Set(vault.books.filter(book=>!format||(format==='graded')===graded(book)).map(conditionOf))].sort((a,b)=>conditionRank(a)-conditionRank(b)||a.localeCompare(b)),[vault.books,format]);
 const books=useMemo(()=>{
  const q=query.trim().toLowerCase().replace('#','');
  const pool=tab==='trade'?vault.books.filter(book=>trade.has(book.id)):vault.books;
  return pool.filter(book=>{const record=lookup(directoryId(book));
   if(q&&!(book.title+' '+book.issue+' '+(record?.publisher||'')+' '+(record?.year||'')+' '+(record?.characters||[]).join(' ')+' '+creatorsOf(record).join(' ')).toLowerCase().replace('#','').includes(q))return false;
   if(publisher&&record?.publisher!==publisher)return false;
   if(format==='graded'&&!graded(book))return false;if(format==='raw'&&graded(book))return false;
   if(condition&&conditionOf(book)!==condition)return false;
   if(tradeOnly&&!trade.has(book.id))return false;
   if(era&&record?.era!==era)return false;if(character&&!(record?.characters||[]).includes(character))return false;if(creator&&!creatorsOf(record).includes(creator))return false;
   if(keysOnly&&!keyed(book))return false;if(inRun&&!inARun(book))return false;return true;})
   .sort((a,b)=>{const ra=lookup(directoryId(a)),rb=lookup(directoryId(b));
    if(sort==='title')return a.title.localeCompare(b.title)||issueNumber(a.issue)-issueNumber(b.issue);
    if(sort==='issue')return issueNumber(a.issue)-issueNumber(b.issue)||a.title.localeCompare(b.title);
    if(sort==='year')return (ra?.year||9999)-(rb?.year||9999);
    if(sort==='publisher')return (ra?.publisher||'~').localeCompare(rb?.publisher||'~')||a.title.localeCompare(b.title);
    return (order.get(b.id)||0)-(order.get(a.id)||0);});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[vault.books,vault.tradeBookIds,tab,query,publisher,format,condition,tradeOnly,sort,lookup,order,era,character,creator,keysOnly,inRun,shop]);
 const filtersOn=!!(publisher||format||condition||tradeOnly||era||character||creator||keysOnly||inRun)||sort!=='recent';
 // A condition that no longer exists (copy edited/removed, or hidden by the raw/graded filter) is dropped.
 if(condition&&!conditions.includes(condition))setCondition('');
 const menuRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!menu)return;const close=(event:PointerEvent)=>{if(menuRef.current&&!menuRef.current.contains(event.target as Node))setMenu(null)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[menu]);

 const setTrade=async(bookIds:string[],on:boolean)=>{const next=on?[...new Set([...vault.tradeBookIds,...bookIds])]:vault.tradeBookIds.filter(id=>!bookIds.includes(id));if(await p.commit({...vault,tradeBookIds:next}))p.notice(on?(bookIds.length>1?bookIds.length+' comics marked for trade.':'Marked for trade.'):'Taken off your trade pile.')};
 const remove=async(bookIds:string[])=>{const blocked=bookIds.filter(id=>p.listedBookIds.has(id));if(blocked.length){p.notice('That comic is listed for sale. Take down the listing first.');return}if(await p.commit({...vault,books:vault.books.filter(book=>!bookIds.includes(book.id)),tradeBookIds:vault.tradeBookIds.filter(id=>!bookIds.includes(id))})){p.notice(bookIds.length>1?bookIds.length+' comics removed.':'Comic removed.');setSelected(new Set());setSelecting(false);setDetail(null)}};
 // Hand the exact copies to the listing builder so the seller doesn't search for them again.
 const sell=(bookIds:string[])=>{const free=bookIds.filter(id=>!p.listedBookIds.has(id));if(!free.length){p.notice(bookIds.length>1?'Those comics are already listed for sale.':'That comic is already listed for sale.');return}handOffBooksForSale(free);window.location.assign('/?'+new URLSearchParams({section:'Marketplace',sell:free.length>1?'collection':'single'}))};
 const exportCollection=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(vault,null,2)],{type:'application/json'}));a.download='comichuddle-collection.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
 const toggleSelect=(id:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next});
 const bookIds=new Set(vault.books.map(book=>book.id)),tradeCount=vault.tradeBookIds.filter(id=>bookIds.has(id)).length;

 const header=<PageHeader eyebrow="My collection" title="My collection." accent="Every book, one place." lede="Every comic you own, in one place. Only you can see your prices and notes." pose="add-comic" caption="Your longbox" line="Every detail counts."
  actions={<><AddMenu onAdd={p.onAdd} onScan={p.onScan} onBrowse={p.onBrowse}/><button type="button" className="ds-link" onClick={exportCollection}><Download size={16}/> Export</button></>}/>;

 if(!p.signedIn)return <section className="mc">{header}<EmptyState title="Sign in to see your collection." message="Join free to save comics, track wants and build your trade pile." action={{label:'Join free',href:'/sign-in?mode=register'}} secondary={{label:'Sign in',href:'/sign-in?return_to=%2F%3Fsection%3DCollection'}}/></section>;

 const record=(book:Book)=>lookup(directoryId(book));
 const badges=(book:Book)=><>{trade.has(book.id)&&<span className="mc-badge trade">For trade</span>}{p.listedBookIds.has(book.id)&&<span className="mc-badge listed">Listed for sale</span>}{featured.has(book.id)&&<span className="mc-badge featured">Featured</span>}</>;
 const cardMenu=(book:Book)=><div className="mc-menu" ref={menu===book.id?menuRef:undefined}>
  <button type="button" className="mc-menu-button" aria-label={'Options for '+book.title+' '+book.issue} aria-haspopup="menu" aria-expanded={menu===book.id} onClick={event=>{event.stopPropagation();setMenu(menu===book.id?null:book.id)}}><MoreHorizontal size={20}/></button>
  {menu===book.id&&<div className="mc-menu-list" role="menu">
   <button role="menuitem" type="button" onClick={()=>{setMenu(null);p.onEdit(book.id)}}><Pencil size={16}/> Edit details</button>
   <button role="menuitem" type="button" onClick={()=>{setMenu(null);p.onFeature()}}><Sparkles size={16}/> {featured.has(book.id)?'Change showcase':'Feature on showcase'}</button>
   <button role="menuitem" type="button" disabled={saving} onClick={()=>{setMenu(null);void setTrade([book.id],!trade.has(book.id))}}><Repeat2 size={16}/> {trade.has(book.id)?'Remove from trade pile':'Mark for trade'}</button>
   <button role="menuitem" type="button" disabled={p.listedBookIds.has(book.id)} onClick={()=>{setMenu(null);sell([book.id])}}><ShoppingBag size={16}/> {p.listedBookIds.has(book.id)?'Already listed':'Sell this comic'}</button>
   <button role="menuitem" type="button" className="danger" disabled={saving} onClick={()=>{setMenu(null);setConfirmRemove([book.id])}}><Trash2 size={16}/> Remove</button>
  </div>}
 </div>;

 const issueLabel=(book:Book)=>book.title+' '+(/^#/.test(book.issue)||!book.issue?book.issue:'#'+book.issue);
 const peekLabel=(book:Book)=>'Peek inside '+issueLabel(book)+': see full details';
 const peek=<span className="peek-inside mc-peek" aria-hidden="true">Peek inside <ArrowRight size={15}/></span>;
 const card=(book:Book)=>{const r=record(book),isSelected=selected.has(book.id);
  const open=()=>selecting?toggleSelect(book.id):setDetail(book.id);
  return view==='grid'?<article key={book.id} className={'mc-card'+(isSelected?' selected':'')}>
   <button type="button" className="mc-card-open" onClick={open} aria-pressed={selecting?isSelected:undefined} aria-label={selecting?'Select '+issueLabel(book):peekLabel(book)}>
    <span className="mc-cover"><ComicArt book={book}/>{selecting&&<span className="mc-check" aria-hidden="true">{isSelected&&<Check size={18}/>}</span>}</span>
    <strong>{book.title} <span>{book.issue}</span></strong>
    {!selecting&&peek}
    <small>{[r?.publisher,r?.year].filter(Boolean).join(' · ')||' '}</small>
   </button>
   <div className="mc-card-foot"><span className="mc-chip">{book.grade}</span>{!selecting&&cardMenu(book)}</div>
   <div className="mc-badges">{badges(book)}</div>
  </article>
  :<article key={book.id} className={'mc-row'+(isSelected?' selected':'')}>
   <button type="button" className="mc-row-open" onClick={open} aria-pressed={selecting?isSelected:undefined} aria-label={selecting?'Select '+issueLabel(book):peekLabel(book)}>
    {selecting&&<span className="mc-check" aria-hidden="true">{isSelected&&<Check size={16}/>}</span>}
    <span className="mc-row-cover"><ComicArt book={book} small/></span>
    <span className="mc-row-text"><strong>{book.title} <span>{book.issue}</span></strong><small>{[r?.publisher,r?.year].filter(Boolean).join(' · ')}</small></span>
    <span className="mc-chip">{book.grade}</span>
    {!selecting&&peek}
   </button>
   <div className="mc-badges">{badges(book)}</div>
   {!selecting&&cardMenu(book)}
  </article>};

 const wants=vault.wants;
 const detailBook=detail?vault.books.find(book=>book.id===detail):undefined;
 return <section className="mc">
  {mode==='list'?header:null}
  {mode==='shop'&&p.loaded&&<ShopFront name={p.name||'Your'} since={p.since||new Date().getFullYear()} books={vault.books} tradeIds={trade} shop={shop} record={record} directoryId={directoryId} busy={saving||shopBusy}
   art={(book,small)=><ComicArt book={book} small={small}/>} addMenu={<AddMenu onAdd={p.onAdd} onScan={p.onScan} onBrowse={p.onBrowse} label="Stock comics"/>}
   onSearch={q=>openList(()=>{setQuery(q);p.onTab('collection')})} onSeeAll={()=>openList(()=>{setSort('recent');p.onTab('collection')})}
   onOpenBook={id=>setDetail(id)} onOpenTrade={()=>openList(()=>p.onTab('trade'))} onOpenBin={pub=>openList(()=>{setPublisher(pub);p.onTab('collection')})}
   onNewRun={()=>{setRunError('');setRunSetup({issue:null,from:'1',to:'12',title:''})}} onDeleteRun={id=>void deleteRun(id)} onAddMissing={run=>void addMissing(run)} onWindow={w=>void setWindow(w)}/>}
  {mode==='list'&&p.loaded&&<button type="button" className="ds-link mc-back-shop" onClick={()=>{setMode('shop');setQuery('');setPublisher('');setEra('');setCharacter('');setCreator('');setKeysOnly(false);setInRun(false)}}><ArrowRight size={16} style={{transform:'rotate(180deg)'}} aria-hidden="true"/> Back to the shop</button>}
  {mode==='shop'&&p.loaded?null:!p.loaded?<LoadingState message={p.status.includes('unavailable')?'Couldn’t load your collection.':'Loading your collection…'}/>:<>
  <div className="mc-summary" role="list">
   <div role="listitem"><strong>{vault.books.length}</strong><span>Comics</span></div>
   {SHOW_WANTS&&<div role="listitem"><strong>{wants.length}</strong><span>Wants</span></div>}
   <div role="listitem"><strong>{tradeCount}</strong><span>For trade</span></div>
   <div role="listitem"><strong>{p.featuredIds.length}</strong><span>On showcase</span></div>
  </div>
  {p.status.startsWith('Save failed')||p.status.includes('unavailable')?<p className="ds-error" role="alert">Couldn’t reach your collection. <button type="button" className="ds-link" onClick={p.onReconnect}>Try again</button></p>:null}

  <div className="mc-tabs" role="tablist" aria-label="Collection views">
   {([['collection','Collection',vault.books.length],['trade','For trade',tradeCount],...(SHOW_WANTS?[['wants','Wants',wants.length]]:[])] as [CollectionTab,string,number][]).map(([id,label,count])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>{setSelected(new Set());setSelecting(false);p.onTab(id)}}>{label} <em>{count}</em></button>)}
  </div>

  {tab!=='wants'&&<>
   <div className="mc-toolbar">
    <div className="mc-search"><Search size={18} aria-hidden="true"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search my comics" aria-label="Search my comics"/>{query&&<button type="button" className="mc-search-clear" aria-label="Clear search" onClick={()=>setQuery('')}><X size={16}/></button>}</div>
    <div className="mc-filters" data-open={sheet}>
     <div className="mc-sheet-head"><strong>Sort &amp; filter</strong><button type="button" aria-label="Close sort and filter" onClick={()=>setSheet(false)}><X size={22}/></button></div>
     <label className="ds-field"><span>Sort</span><select value={sort} onChange={event=>setSort(event.target.value as Sort)}>{sorts.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label className="ds-field"><span>Publisher</span><select value={publisher} onChange={event=>setPublisher(event.target.value)}><option value="">All publishers</option>{publishers.map(name=><option key={name}>{name}</option>)}</select></label>
     <label className="ds-field"><span>Raw or graded</span><select value={format} onChange={event=>setFormat(event.target.value as ''|'raw'|'graded')}><option value="">Raw and graded</option><option value="raw">Raw only</option><option value="graded">Graded only</option></select></label>
     <label className="ds-field"><span>Condition</span><select value={condition} onChange={event=>setCondition(event.target.value)} disabled={!conditions.length}><option value="">All conditions</option>{conditions.map(label=><option key={label} value={label}>{label}</option>)}</select></label>
     <label className="ds-field"><span>Era</span><select value={era} onChange={event=>setEra(event.target.value)} disabled={!eras.length}><option value="">All eras</option>{eras.map(name=><option key={name}>{name}</option>)}</select></label>
     <label className="ds-field"><span>Character</span><select value={character} onChange={event=>setCharacter(event.target.value)} disabled={!characters.length}><option value="">All characters</option>{characters.map(name=><option key={name}>{name}</option>)}</select></label>
     <label className="ds-field"><span>Creator</span><select value={creator} onChange={event=>setCreator(event.target.value)} disabled={!creators.length}><option value="">All creators</option>{creators.map(name=><option key={name}>{name}</option>)}</select></label>
     <label className="mc-toggle"><input type="checkbox" checked={keysOnly} onChange={event=>setKeysOnly(event.target.checked)}/> Keys only</label>
     <label className="mc-toggle"><input type="checkbox" checked={inRun} onChange={event=>setInRun(event.target.checked)}/> In a run</label>
     {tab==='collection'&&<label className="mc-toggle"><input type="checkbox" checked={tradeOnly} onChange={event=>setTradeOnly(event.target.checked)}/> For trade only</label>}
     <button type="button" className="ds-btn ds-btn-primary mc-sheet-done" onClick={()=>setSheet(false)}>Show {books.length} comics</button>
    </div>
    <button type="button" className={'ds-btn ds-btn-secondary mc-filter-button'+(filtersOn?' on':'')} onClick={()=>setSheet(true)}><SlidersHorizontal size={18}/> Sort &amp; filter</button>
    <div className="mc-view" role="group" aria-label="Layout"><button type="button" aria-pressed={view==='grid'} aria-label="Grid view" onClick={()=>setView('grid')}><Grid3X3 size={18}/></button><button type="button" aria-pressed={view==='list'} aria-label="List view" onClick={()=>setView('list')}><List size={18}/></button></div>
    {vault.books.length>0&&<button type="button" className={'ds-btn ds-btn-secondary ds-btn-sm'+(selecting?' on':'')} onClick={()=>{setSelecting(!selecting);setSelected(new Set())}}><CheckSquare size={17}/> {selecting?'Done':'Select'}</button>}
   </div>
   {(publisher||format||condition||tradeOnly||era||character||creator||keysOnly||inRun)&&<div className="mc-active-filters" aria-label="Active filters">
    {era&&<button type="button" className="mc-active-chip" aria-label={'Remove the era filter: '+era} onClick={()=>setEra('')}>{era}<X size={14} aria-hidden="true"/></button>}
    {character&&<button type="button" className="mc-active-chip" aria-label={'Remove the character filter: '+character} onClick={()=>setCharacter('')}>{character}<X size={14} aria-hidden="true"/></button>}
    {creator&&<button type="button" className="mc-active-chip" aria-label={'Remove the creator filter: '+creator} onClick={()=>setCreator('')}>{creator}<X size={14} aria-hidden="true"/></button>}
    {keysOnly&&<button type="button" className="mc-active-chip" aria-label="Remove the keys only filter" onClick={()=>setKeysOnly(false)}>Keys only<X size={14} aria-hidden="true"/></button>}
    {inRun&&<button type="button" className="mc-active-chip" aria-label="Remove the in a run filter" onClick={()=>setInRun(false)}>In a run<X size={14} aria-hidden="true"/></button>}
    {publisher&&<button type="button" className="mc-active-chip" aria-label={'Remove the publisher filter: '+publisher} onClick={()=>setPublisher('')}>{publisher}<X size={14} aria-hidden="true"/></button>}
    {format&&<button type="button" className="mc-active-chip" aria-label={'Remove the '+format+' filter'} onClick={()=>setFormat('')}>{format==='raw'?'Raw only':'Graded only'}<X size={14} aria-hidden="true"/></button>}
    {condition&&<button type="button" className="mc-active-chip" aria-label={'Remove the condition filter: '+condition} onClick={()=>setCondition('')}>{condition}<X size={14} aria-hidden="true"/></button>}
    {tradeOnly&&<button type="button" className="mc-active-chip" aria-label="Remove the for trade only filter" onClick={()=>setTradeOnly(false)}>For trade only<X size={14} aria-hidden="true"/></button>}
   </div>}
   {sheet&&<div className="mc-scrim" onClick={()=>setSheet(false)} aria-hidden="true"/>}
   {selecting&&<div className="mc-bulk" role="region" aria-label="Bulk actions"><strong>{selected.size} selected</strong>
    {books.length>0&&(books.every(book=>selected.has(book.id))
     ?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setSelected(new Set())}>Clear selection</button>
     :<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setSelected(new Set(books.map(book=>book.id)))}><CheckSquare size={16}/> Select all {books.length}</button>)}
    {tab==='trade'||(selected.size>0&&[...selected].every(id=>trade.has(id)))
     ?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!selected.size||saving} onClick={()=>void setTrade([...selected],false).then(()=>setSelected(new Set()))}><Repeat2 size={16}/> Take off trade</button>
     :<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!selected.size||saving} onClick={()=>void setTrade([...selected],true)}><Repeat2 size={16}/> Mark for trade</button>}
    <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!selected.size} onClick={()=>sell([...selected])}><ShoppingBag size={16}/> {selected.size>1?'Sell together':'Sell'}</button>
    <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm mc-danger" disabled={!selected.size||saving} onClick={()=>setConfirmRemove([...selected])}><Trash2 size={16}/> Remove</button>
   </div>}
   {loading&&<p className="mc-quiet" role="status">Loading publisher and year details…</p>}
   {!vault.books.length?<EmptyState title="Your longbox is waiting." message="Add your first comic. Scan it, search for it, or add it by hand." action={{label:'Scan a comic',onClick:p.onScan}} secondary={{label:'Search the directory',onClick:p.onBrowse}}/>
    :tab==='trade'&&!tradeCount?<EmptyState compact title="Nothing in your trade pile yet." message="Open a comic's ⋯ menu and pick “Mark for trade”."/>
    :!books.length?<EmptyState compact title="No comics match." message="Try another search or clear the filters." action={{label:'Clear filters',onClick:()=>{setQuery('');setPublisher('');setFormat('');setCondition('');setTradeOnly(false);setSort('recent');setEra('');setCharacter('');setCreator('');setKeysOnly(false);setInRun(false)}}}/>
    :<><div className={view==='grid'?'mc-grid':'mc-list'}>{books.slice(0,shown).map(card)}</div>{books.length>shown&&<div className="mc-more"><span>Showing {shown} of {books.length}</span><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setShown(value=>value+pageSize*2)}>Show more</button></div>}</>}
  </>}

  {tab==='wants'&&(!wants.length?<EmptyState title="No wants yet." message="Save issues you're hunting for from the directory." action={{label:'Browse the directory',onClick:p.onBrowse}}/>
   :<div className="mc-grid">{wants.map(id=>{const r=lookup(id);return <article key={id} className="mc-card">
    <button type="button" className="mc-card-open" onClick={()=>p.onOpenIssue(id)} aria-label={'Peek inside '+(r?r.title+' #'+r.number.replace(/^#/,''):'saved issue')+': see full details'}><span className="mc-cover">{r?<ComicArt issue={r}/>:<span className="mc-cover-empty"><Bookmark size={28}/></span>}</span><strong>{r?<>{r.title} <span>#{r.number}</span></>:'Saved issue'}</strong><small>{r?[r.publisher,r.year].filter(Boolean).join(' · '):'Loading…'}</small>{peek}</button>
    <div className="mc-want-actions"><button type="button" className="ds-btn ds-btn-primary ds-btn-sm" onClick={()=>p.onFindForSale(id)}>Find for sale</button><button type="button" className="mc-icon" disabled={saving} aria-label={'Remove '+(r?.title||'issue')+' from wants'} onClick={()=>void p.commit({...vault,wants:vault.wants.filter(n=>n!==id)}).then(ok=>{if(ok)p.notice('Removed from your wants.')})}><X size={18}/></button></div>
   </article>})}</div>)}
  </>}

  {detailBook&&<Modal label={detailBook.title+' '+detailBook.issue} onClose={()=>setDetail(null)}><div className="mc-detail">
   <div className="mc-detail-cover"><ComicArt book={detailBook}/>
    <label className="ds-btn ds-btn-secondary ds-btn-sm mc-photo"><Upload size={16}/>{photoBusy===detailBook.id?'Uploading…':detailBook.photoId?'Replace my photo':'Add my photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!photoBusy||saving} onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setPhotoBusy(detailBook.id);try{const photoId=await uploadPhoto(file);if(await p.commit({...vault,books:vault.books.map(b=>b.id===detailBook.id?{...b,photoId}:b)}))p.notice('Photo saved.')}catch(error){p.notice(error instanceof Error?error.message:'Couldn’t upload that photo. Try again.')}finally{setPhotoBusy('')}}}/></label>
   </div>
   <div className="mc-detail-copy">
    <p className="ds-eyebrow">{record(detailBook)?.publisher||'Your comic'}{record(detailBook)?.year?' · '+record(detailBook)?.year:''}</p>
    <h2>{detailBook.title} <span>{detailBook.issue}</span></h2>
    <div className="mc-badges inline">{badges(detailBook)}</div>
    {(()=>{const id=directoryId(detailBook),k=id===null?null:shop?.keys[String(id)];return k?<p className="mc-key-note"><b>Key:</b> {k.reasons[0]||k.note}</p>:null})()}
    {record(detailBook)&&<p>{record(detailBook)?.note}</p>}
    {directoryId(detailBook)!==null&&<button type="button" className="ds-link" onClick={()=>{const id=directoryId(detailBook);setDetail(null);if(id!==null)p.onOpenIssue(id)}}>See the full issue page <ArrowRight size={16}/></button>}
    <div className="mc-private" aria-labelledby="mc-private-title"><p className="mc-private-head"><span className="ds-eyebrow" id="mc-private-title">Your copy</span><span className="mc-private-tag"><Lock size={14} aria-hidden="true"/> Only you can see this</span></p><dl>
     <dt>Condition</dt><dd>{detailBook.grade}</dd>
     {detailBook.ownership?.certificationNumber&&<><dt>CGC cert #</dt><dd>{detailBook.ownership.certificationNumber}</dd></>}
     <dt>You paid</dt><dd>{money(detailBook.ownership?.purchasePriceCents)||(detailBook.price>0?money(String(Math.round(detailBook.price*100))):null)||'Not recorded'}</dd>
     {detailBook.ownership?.acquiredOn&&<><dt>Got it on</dt><dd>{detailBook.ownership.acquiredOn}</dd></>}
     <dt>Notes</dt><dd>{detailBook.ownership?.notes||'None'}</dd>
    </dl></div>
    {p.listedBookIds.has(detailBook.id)&&<p className="mc-quiet">This comic is listed for sale. Take down the listing to edit it.</p>}
    <div className="ds-actions">
     <button type="button" className="ds-btn ds-btn-primary" disabled={p.listedBookIds.has(detailBook.id)} onClick={()=>{setDetail(null);p.onEdit(detailBook.id)}}><Pencil size={17}/> Edit</button>
     <button type="button" className="ds-btn ds-btn-secondary" disabled={p.listedBookIds.has(detailBook.id)} onClick={()=>sell([detailBook.id])}><ShoppingBag size={17}/> Sell</button>
     <button type="button" className="ds-btn ds-btn-secondary" disabled={saving} onClick={()=>void setTrade([detailBook.id],!trade.has(detailBook.id))}><Repeat2 size={17}/> {trade.has(detailBook.id)?'Untrade':'Trade'}</button>
     <button type="button" className="ds-link mc-danger-link" disabled={saving||p.listedBookIds.has(detailBook.id)} onClick={()=>setConfirmRemove([detailBook.id])}><Trash2 size={16}/> Remove</button>
    </div>
   </div>
  </div></Modal>}

  {runSetup&&<Modal label="New run" onClose={()=>setRunSetup(null)}><form className="mc-confirm mc-run-setup" onSubmit={event=>{event.preventDefault();void createRun()}}>
   <h2>Start a run</h2><p>Pick any issue of the series from the Directory, then the issue range you’re collecting.</p>
   <ComicPicker value={runSetup.issue} onChange={issue=>setRunSetup(r=>r&&{...r,issue})} label="Series (pick any issue)" disabled={shopBusy}/>
   <div className="mc-run-range"><label className="ds-field"><span>From #</span><input inputMode="numeric" value={runSetup.from} onChange={e=>setRunSetup(r=>r&&{...r,from:e.target.value.replace(/\D/g,'')})} required/></label><label className="ds-field"><span>To #</span><input inputMode="numeric" value={runSetup.to} onChange={e=>setRunSetup(r=>r&&{...r,to:e.target.value.replace(/\D/g,'')})} required/></label></div>
   <label className="ds-field"><span>Name (optional)</span><input value={runSetup.title} maxLength={80} onChange={e=>setRunSetup(r=>r&&{...r,title:e.target.value})} placeholder="Claremont X-Men"/></label>
   {runError&&<p className="ds-error" role="alert">{runError}</p>}
   <div className="ds-actions"><button type="submit" className="ds-btn ds-btn-primary" disabled={shopBusy||!runSetup.issue}>Add to the wall</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setRunSetup(null)}>Cancel</button></div>
  </form></Modal>}
  {confirmRemove&&<Modal label="Remove comics" onClose={()=>setConfirmRemove(null)}><div className="mc-confirm">
   <h2>Remove {confirmRemove.length>1?confirmRemove.length+' comics':'this comic'}?</h2>
   <p>It comes off your collection. You can add it again any time.</p>
   <div className="ds-actions"><button type="button" className="ds-btn ds-btn-primary" disabled={saving} onClick={()=>{const ids=confirmRemove;setConfirmRemove(null);void remove(ids)}}>Remove</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setConfirmRemove(null)}>Keep it</button></div>
  </div></Modal>}
 </section>;
}

function AddMenu({onAdd,onScan,onBrowse,label='Add comics'}:{onAdd:()=>void;onScan:()=>void;onBrowse:()=>void;label?:string}){
 const [open,setOpen]=useState(false),box=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(box.current&&!box.current.contains(event.target as Node))setOpen(false)};const esc=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',esc)}},[open]);
 return <div className="mc-add" ref={box}>
  <button type="button" className="ds-btn ds-btn-primary" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><Plus size={18}/> {label} <ChevronDown size={16}/></button>
  {open&&<div className="mc-menu-list mc-add-list" role="menu">
   <button role="menuitem" type="button" onClick={()=>{setOpen(false);onScan()}}><Camera size={17}/> Scan</button>
   <button role="menuitem" type="button" onClick={()=>{setOpen(false);onBrowse()}}><Search size={17}/> From Directory</button>
   <button role="menuitem" type="button" onClick={()=>{setOpen(false);onAdd()}}><Pencil size={17}/> Import list</button>
  </div>}
 </div>;
}
