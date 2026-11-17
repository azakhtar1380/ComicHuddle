'use client';
// Notification bell (round 4). <NotificationBell variant="header"/> sits with the header icons (uses the
// header's .chx-icon/.chx-badge styles) and opens a dropdown hanging from the bell on every screen size;
// <NotificationBell variant="dock"/> is a phone-bar tab (.dock3-*) that always opens the bottom sheet. Renders nothing for guests. Data: /api/notifications.
import {useCallback,useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {Bell,CheckCheck,Trophy,X} from 'lucide-react';
import {activateDialog} from '../../lib/dialog-focus';
import './bell.css';
import '../../app/design-system-hscroll.css';

type Item={id:string;kind:string;title:string;body:string;href:string;createdAt:string;read:boolean};
type Data={items:Item[];unread:number};
const POLL_MS=60000;

function ago(iso:string){
 const ms=Date.now()-Date.parse(iso);if(!Number.isFinite(ms))return '';
 const m=Math.round(ms/60000);if(m<1)return 'Just now';if(m<60)return m+'m ago';
 const h=Math.round(m/60);if(h<24)return h+'h ago';const d=Math.round(h/24);if(d<7)return d+'d ago';
 return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function valid(value:unknown):value is Data{
 if(!value||typeof value!=='object')return false;const d=value as Partial<Data>;
 return Array.isArray(d.items)&&typeof d.unread==='number'&&d.items.every(i=>i&&typeof i.id==='string'&&typeof i.title==='string'&&typeof i.body==='string'&&typeof i.href==='string'&&typeof i.createdAt==='string'&&typeof i.read==='boolean');
}
/** Only same-site paths are followed (the server also stores only "/..." links). */
const safeHref=(href:string)=>href.startsWith('/')&&!href.startsWith('//')?href:'';

/** null = keep the last list (offline, aborted, unreadable). */
async function fetchNotifications(signal?:AbortSignal):Promise<Data|'guest'|null>{
 try{const r=await fetch('/api/notifications?limit=20',{cache:'no-store',credentials:'same-origin',signal});if(r.status===401)return 'guest';const d:unknown=await r.json();return r.ok&&valid(d)?d:null}catch{return null}
}
export function useNotifications(){
 const [data,setData]=useState<Data|null>(null),[guest,setGuest]=useState(false),alive=useRef(true);
 const apply=useCallback((result:Data|'guest'|null)=>{if(!alive.current||result===null)return;if(result==='guest')setGuest(true);else{setGuest(false);setData(result)}},[]);
 const load=useCallback((signal?:AbortSignal)=>fetchNotifications(signal).then(apply),[apply]);
 useEffect(()=>{alive.current=true;const controller=new AbortController();void fetchNotifications(controller.signal).then(apply);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},POLL_MS);
  const onFocus=()=>{if(document.visibilityState==='visible')void load()};document.addEventListener('visibilitychange',onFocus);
  return()=>{alive.current=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',onFocus)}},[load,apply]);
 const markRead=useCallback(async(ids?:string[])=>{
  setData(current=>current?{items:current.items.map(i=>!ids||ids.includes(i.id)?{...i,read:true}:i),unread:ids?Math.max(0,current.unread-current.items.filter(i=>ids.includes(i.id)&&!i.read).length):0}:current);
  try{await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(ids?{ids}:{}),keepalive:true})}catch{}
 },[]);
 return {data,guest,reload:load,markRead};
}

const FILTERS=[['all','All'],['trophies','Trophies'],['orders','Orders'],['offers','Offers'],['community','Community']] as const;
type Filter=typeof FILTERS[number][0];
const inFilter=(kind:string,filter:Filter)=>filter==='all'||(filter==='trophies'?kind==='achievement':filter==='orders'?['order','safepurchase','tracking','payout','pickup'].includes(kind):filter==='offers'?['offer','offer_reply','trade'].includes(kind):['verification','system'].includes(kind));
/** "Almost there" notifications carry progress as "progress:x/y" in the body. */
const progressOf=(body:string)=>{const m=/^progress:(\d+)\/(\d+)$/.exec(body);return m?{n:Number(m[1]),of:Number(m[2])}:null};
function List({data,markRead,onClose,titleId}:{data:Data|null;markRead:(ids?:string[])=>Promise<void>;onClose:()=>void;titleId:string}){
 const [filter,setFilter]=useState<Filter>('all'),items=data?.items.filter(i=>inFilter(i.kind,filter))||[];
 return <>
  <div className="nb-head"><h2 id={titleId}>Notifications</h2>
   {!!data?.unread&&<button type="button" className="nb-mark" onClick={()=>void markRead()}><CheckCheck size={16}/> Mark all read</button>}
   <button type="button" className="nb-close" aria-label="Close notifications" onClick={onClose}><X size={20}/></button></div>
  <div className="nb-filters ch-hscroll" role="toolbar" aria-label="Filter notifications">{FILTERS.map(([id,label])=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
  {!data?<p className="nb-empty" role="status">Loading…</p>:!items.length&&data.items.length?<p className="nb-empty">Nothing here yet.</p>:!data.items.length?<p className="nb-empty">You’re all caught up. Offers, replies and order updates show up here.</p>:
   <ul className="nb-list">{items.map(item=>{const href=safeHref(item.href),trophy=item.kind==='achievement',progress=progressOf(item.body);const body=<>{trophy?<span className="nb-trophy" aria-hidden="true"><Trophy size={16}/></span>:<span className="nb-dot" aria-hidden="true" data-on={!item.read}/>}<span className="nb-text"><strong>{item.title}</strong>{progress?<span className="nb-progress" role="progressbar" aria-label={item.title} aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={progress.n}><i style={{width:Math.round(progress.n/Math.max(1,progress.of)*100)+'%'}}/></span>:item.body&&<span>{item.body}</span>}<time dateTime={item.createdAt}>{ago(item.createdAt)}</time></span></>;
    return <li key={item.id} className={(item.read?'':'is-unread')+(trophy?' is-trophy':'')}>{href?<a href={href} onClick={()=>{if(!item.read)void markRead([item.id])}}>{body}{!item.read&&<span className="sr-only"> (unread)</span>}</a>:<button type="button" onClick={()=>{if(!item.read)void markRead([item.id])}}>{body}</button>}</li>})}</ul>}
 </>;
}

/** The phone bottom sheet: a native modal dialog (focus trap, Escape) plus the shared body scroll lock. */
function Sheet({open,onClose,titleId,data,markRead}:{open:boolean;onClose:()=>void;titleId:string;data:Data|null;markRead:(ids?:string[])=>Promise<void>}){
 const sheet=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=sheet.current;if(!node)return;if(open&&!node.open)node.showModal();else if(!open&&node.open)node.close()},[open]);
 useEffect(()=>{if(!open)return;return activateDialog(sheet.current,onClose)},[open,onClose]);
 return <dialog ref={sheet} className="nb-sheet" aria-labelledby={titleId} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="nb-sheet-body"><span className="nb-grip" aria-hidden="true"/><List data={data} markRead={markRead} onClose={onClose} titleId={titleId}/></div>
 </dialog>;
}

export function NotificationBell({variant='header'}:{variant?:'header'|'dock'}){
 const {data,guest,reload,markRead}=useNotifications(),[open,setOpen]=useState(false),titleId=useId();
 const wrap=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 // Where the dropdown sits: under the bell, kept 12px inside the window; the pointer lines up with the bell.
 const [place,setPlace]=useState<{top:number;left:number;width:number;arrow:number}|null>(null);
 const close=useCallback(()=>{setOpen(false);requestAnimationFrame(()=>button.current?.focus())},[]);
 const asSheet=variant==='dock';
 useEffect(()=>{if(open)void reload()},[open,reload]);
 // Desktop dropdown: anchored under the bell, kept 12px inside the window; closes on outside click / Escape.
 useEffect(()=>{if(!open||asSheet)return;
  const position=()=>{const b=button.current?.getBoundingClientRect();if(!b)return;const vw=document.documentElement.clientWidth,width=Math.min(380,vw-24),center=b.left+b.width/2;
   const left=Math.min(Math.max(12,center-width+36),vw-12-width);setPlace({top:Math.round(b.bottom+10),left:Math.round(left),width:Math.round(width),arrow:Math.round(Math.min(Math.max(18,center-left),width-18))})};position();
  const down=(e:MouseEvent)=>{if(wrap.current&&!wrap.current.contains(e.target as Node))setOpen(false)};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close()}};
  document.addEventListener('mousedown',down);document.addEventListener('keydown',key);window.addEventListener('resize',position,{passive:true});
  return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key);window.removeEventListener('resize',position)}},[open,asSheet,close]);
 if(guest)return null;
 const unread=data?.unread||0,label='Notifications'+(unread?` (${unread} unread)`:'');
 const sheet=<Sheet open={open} onClose={close} titleId={titleId} data={data} markRead={markRead}/>;
 if(variant==='dock')return <>
  <button ref={button} type="button" className={'dock3-tab nb-dock-tab'+(open?' active':'')} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>
   <span className="dock3-icon"><Bell size={22} strokeWidth={2.2}/>{unread>0&&<span className="nb-dock-badge" aria-hidden="true">{unread>9?'9+':unread}</span>}</span><span className="dock3-label">Alerts</span>
  </button>{sheet}
 </>;
 return <div className="nb-wrap" ref={wrap}>
  <button ref={button} type="button" className="chx-icon nb-bell" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
   <Bell size={22}/>{unread>0&&<span className="chx-badge">{unread>99?'99+':unread}</span>}<span className="chx-icon-label">Alerts</span>
  </button>
  {asSheet?sheet:open&&<div ref={panel} className="nb-panel" role="dialog" aria-labelledby={titleId} style={place?{top:place.top,left:place.left,width:place.width,'--nb-arrow':place.arrow+'px'} as CSSProperties:{visibility:'hidden'}}><List data={data} markRead={markRead} onClose={close} titleId={titleId}/></div>}
 </div>;
}
export default NotificationBell;
