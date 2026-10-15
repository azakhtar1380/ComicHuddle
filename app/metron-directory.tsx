'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,BookOpen,Check,ChevronRight,KeyRound,Link2,Lock,Plus,Search,Unplug} from 'lucide-react';
import {createMetronSession,isMetronToken,METRON_LICENSE_URL,MetronDirectoryError,metronPersonalEntry,requestMetronClient,type MetronClientAction,type MetronIssue,type MetronPersonalEntry} from '../lib/metron-directory';
import './metron-directory.css';

type Props={signedIn:boolean;onJoin:()=>void;onAdd?:(book:MetronPersonalEntry)=>Promise<boolean>};
const outward={target:'_blank',rel:'noopener noreferrer'} as const;

function Attribution(){return <p className="metron-attribution">Comic metadata from <a href="https://metron.cloud" {...outward}>Metron <ArrowUpRight size={12}/></a>, licensed under <a href={METRON_LICENSE_URL} {...outward}>CC BY-SA 4.0</a>. Fields are formatted for this view. Images, synopses and values are omitted.</p>}

export default function MetronDirectory({signedIn,onJoin,onAdd}:Props){
 const sessionRef=useRef<ReturnType<typeof createMetronSession>|null>(null);if(!sessionRef.current)sessionRef.current=createMetronSession(signedIn);const session=sessionRef.current;
 const signedInRef=useRef(signedIn),viewRequestRef=useRef(0),mountedRef=useRef(true),workingRef=useRef(false),tokenInputRef=useRef<HTMLInputElement>(null);
 if(signedInRef.current!==signedIn){signedInRef.current=signedIn;viewRequestRef.current++;session.setSignedIn(signedIn)}
 const [hasToken,setHasToken]=useState(false),[providerVerified,setProviderVerified]=useState(false),[query,setQuery]=useState(''),[activeQuery,setActiveQuery]=useState('');
 const [items,setItems]=useState<MetronIssue[]>([]),[selected,setSelected]=useState<MetronIssue|null>(null),[count,setCount]=useState<number|null>(null),[next,setNext]=useState<string|null>(null),[visibleCount,setVisibleCount]=useState(12);
 const [busy,setBusy]=useState(false),[adding,setAdding]=useState<number|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pauseUntil,setPauseUntil]=useState(0),[pageWarning,setPageWarning]=useState(false);
 function resetView(){viewRequestRef.current++;workingRef.current=false;session.disconnect();if(tokenInputRef.current)tokenInputRef.current.value='';setHasToken(false);setProviderVerified(false);setItems([]);setSelected(null);setCount(null);setNext(null);setActiveQuery('');setBusy(false);setAdding(null);setPauseUntil(0);setError('');setNotice('');setPageWarning(false)}
 useEffect(()=>{mountedRef.current=true;session.mount(signedInRef.current);return()=>{mountedRef.current=false;viewRequestRef.current++;workingRef.current=false;session.dispose();if(tokenInputRef.current)tokenInputRef.current.value=''}},[session]);
 useEffect(()=>{if(!signedIn)resetView()},[signedIn]);
 useEffect(()=>{if(!pauseUntil)return;const timer=setTimeout(()=>setPauseUntil(0),Math.max(0,pauseUntil-Date.now()));return()=>clearTimeout(timer)},[pauseUntil]);
 const paused=pauseUntil>Date.now();
 function connect(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!signedInRef.current){onJoin();return}
  const data=new FormData(event.currentTarget),token=tokenInputRef.current?.value.trim()||'';
  if(data.get('ownToken')!=='on'||!isMetronToken(token)){setError('Use your own Metron token and confirm the metadata terms. Paste the token without the word Bearer.');return}
  if(!session.connect(token)){setError('Sign in before connecting your Metron token.');return}
  viewRequestRef.current++;workingRef.current=false;if(tokenInputRef.current)tokenInputRef.current.value='';setHasToken(true);setProviderVerified(false);setItems([]);setSelected(null);setCount(null);setNext(null);setPauseUntil(0);setError('');setNotice('Token entered for this view. A lookup will confirm access.');setPageWarning(false);
 }
 async function runMetron(action:MetronClientAction){
  if(workingRef.current||!signedInRef.current||!session.hasToken()||pauseUntil>Date.now())return;
  workingRef.current=true;const request=++viewRequestRef.current,current=()=>mountedRef.current&&signedInRef.current&&request===viewRequestRef.current&&session.hasToken();
  setBusy(true);setError('');setNotice('');
  try{
   const result=await requestMetronClient(session,action);if(!current()||result.kind==='ignored')return;
   const data=result.data;setProviderVerified(true);if(data.usage.retryAfterSeconds)setPauseUntil(Date.now()+data.usage.retryAfterSeconds*1000);
   if(data.action==='search'){setItems(data.items);setCount(data.count);setNext(data.next);setActiveQuery(action.action==='search'?action.query:'');setVisibleCount(12);setSelected(null);setPageWarning(data.paginationUnavailable);if(!data.items.length)setNotice('No matching issue records on this page. Try the series title and optional #number.');}
   else setSelected(data.items[0]||null);
  }catch(failure){if(!current())return;setError(failure instanceof MetronDirectoryError?failure.message:'The Metron connection is unavailable. Try again later.');if(failure instanceof MetronDirectoryError&&failure.retryAfterSeconds)setPauseUntil(Date.now()+failure.retryAfterSeconds*1000)}
  finally{if(current()){workingRef.current=false;setBusy(false)}}
 }
 async function addCopy(issue:MetronIssue){
  if(!signedInRef.current){onJoin();return}if(!onAdd||workingRef.current||!session.hasToken())return;
  workingRef.current=true;const request=++viewRequestRef.current,current=()=>mountedRef.current&&signedInRef.current&&request===viewRequestRef.current&&session.hasToken();setAdding(issue.id);setError('');setNotice('');
  try{if(await onAdd(metronPersonalEntry(issue))&&current())setNotice('Personal copy added. Record its condition in My collection.');else if(current())setError('The copy could not be saved. Check your collection and retry.')}
  catch{if(current())setError('The copy could not be saved. Check your collection and retry.')}
  finally{if(current()){workingRef.current=false;setAdding(null)}}
 }
 return <section className="metron-directory" aria-labelledby="metron-heading">
  <div className="metron-section-head"><div><div className="eyebrow"><Link2 size={14}/> METRON CONNECTION</div><h2 id="metron-heading">MORE ISSUES.<br/><span>YOUR OWN CONNECTION.</span></h2><p>Search Metron’s comic metadata with your own account token. Keep the starter index available while you explore.</p></div><span className={'metron-state '+(providerVerified?'verified':'')}><span/>{providerVerified?'Access confirmed':hasToken?'Token in this view':'Not connected'}</span></div>
  {!signedIn?<div className="metron-signin"><Lock size={22}/><div><strong>A connection for your collector account.</strong><p>Sign in, then connect your own Metron token to search its directory.</p></div><button type="button" className="button yellow" onClick={onJoin}>Sign in to connect <ChevronRight size={16}/></button></div>:!hasToken?<form className="metron-connect" onSubmit={connect}>
   <div className="metron-connect-title"><KeyRound size={21}/><div><h3>Bring your own Metron token</h3><p>In your Metron account, open API Tokens and generate a token for ComicHuddle. <a href="https://metron.cloud" {...outward}>Open Metron <ArrowUpRight size={13}/></a></p></div></div>
   <label className="metron-token-label"><span className="field-label">Your Metron API token<span className="required-mark" aria-hidden="true"> *</span></span><input ref={tokenInputRef} type="password" name="metronToken" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={20} maxLength={256} placeholder="Paste your token here" required data-lpignore="true" data-1p-ignore="true"/></label>
   <label className="metron-token-terms"><input type="checkbox" name="ownToken" required/><span className="required-check-copy"><span>This token belongs to my own Metron account. I understand the <a href={METRON_LICENSE_URL} {...outward}>CC BY-SA metadata terms</a>; artwork needs separate permission.</span><span className="required-mark" aria-hidden="true"> *</span></span></label>
   <div className="metron-connect-bottom"><p><Lock size={14}/> Token stays in this view’s memory. It clears on disconnect, sign-out or leaving this page. The proxy sends it only to Metron.</p><button type="submit" className="button red">Use my token <Link2 size={16}/></button></div>
  </form>:<>
   <div className="metron-connected"><span><KeyRound size={16}/> {providerVerified?'Your token has returned metadata.':'Token entered. Search to check access.'}</span><button type="button" onClick={resetView}><Unplug size={15}/> Disconnect &amp; clear</button></div>
   <form className="metron-search" onSubmit={event=>{event.preventDefault();void runMetron({action:'search',query})}}><label><span className="field-label"><span className="metron-sr-only">Search Metron by series title and optional issue number</span><Search size={20}/><span className="required-mark" aria-hidden="true"> *</span></span><input value={query} onChange={event=>setQuery(event.target.value)} maxLength={160} placeholder="Amazing Spider-Man #300" disabled={busy||adding!==null} required minLength={2}/></label><button type="submit" className="button red" disabled={busy||adding!==null||paused}>{busy?'Looking up…':'Search Metron'}<Search size={16}/></button></form>
   <p className="metron-search-help">Series-title words, case insensitive; add #number for an exact issue number. Publisher, character and creator searches use the starter index above. Every search, page and detail uses one request.</p>
   {selected&&<section className="metron-detail" aria-label="Metron issue details"><div className="metron-detail-title"><BookOpen size={24}/><div><div className="eyebrow">METRON RECORD / {selected.id}</div><h3>{selected.title} #{selected.number}</h3></div></div><dl><div><dt>Publisher</dt><dd>{selected.publisher||'Not returned by this record'}</dd></div><div><dt>Series volume</dt><dd>{selected.volume??'Not recorded'}</dd></div><div><dt>Cover date</dt><dd>{selected.coverDate||'Not recorded'}</dd></div><div><dt>Store date</dt><dd>{selected.storeDate||'Not recorded'}</dd></div></dl>{selected.credits.length>0&&<div className="metron-credits"><strong>Creator credits</strong>{selected.credits.map((credit,index)=><p key={credit.creator+'-'+index}>{credit.creator}<span>{credit.roles.join(', ')||'Role not returned'}</span></p>)}</div>}<div className="metron-detail-actions"><a className="button outline" href={selected.sourceUrl} {...outward}>Source record <ArrowUpRight size={15}/></a>{onAdd&&<button type="button" className="button yellow" disabled={busy||adding!==null} onClick={()=>void addCopy(selected)}>{adding===selected.id?'Saving…':'Add a personal copy'}<Plus size={16}/></button>}</div><p className="metron-search-help">An external metadata record. Your copy keeps its Metron source and license, with condition unrecorded and your estimate at $0. It is not linked to an FMV tuple.</p></section>}
   {count!==null&&<div className="metron-results-head"><strong>{count.toLocaleString()} matching records in Metron</strong><span>{Math.min(visibleCount,items.length)} of {items.length} on this page</span></div>}
   <div className="metron-results">{items.slice(0,visibleCount).map(issue=><article className="metron-result" key={issue.id}><div className="metron-record-mark"><BookOpen size={23}/><span>METADATA<br/>RECORD</span></div><div className="metron-result-copy"><div className="metron-record-id">METRON {issue.id} · {issue.seriesYear??'YEAR NOT RECORDED'}</div><h3>{issue.series}</h3><strong className="metron-issue-number">#{issue.number}</strong><p>{issue.publisher||'Publisher available in details'}{issue.volume!==null?' · Vol. '+issue.volume:''}</p><button type="button" disabled={busy||adding!==null||paused} onClick={()=>{setSelected(issue);void runMetron({action:'detail',id:issue.id})}}>View details <ChevronRight size={14}/></button></div></article>)}</div>
   {items.length>visibleCount&&<button type="button" className="metron-more" onClick={()=>setVisibleCount(value=>Math.min(items.length,value+12))}>Show more from this page <Plus size={15}/></button>}
   {next&&<div className="metron-pagination"><span>Pages load one at a time.</span><button type="button" className="button outline" disabled={busy||adding!==null||paused} onClick={()=>void runMetron({action:'search',query:activeQuery,next})}>Next page <ChevronRight size={16}/></button></div>}
   {pageWarning&&<p className="metron-note">Metron’s next-page link could not be safely used. Search again to continue.</p>}
   {paused&&<p className="metron-note" role="status">Lookup limits pause requests until {new Date(pauseUntil).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}. Your token still belongs to your Metron account.</p>}
  </>}
  {error&&<p className="metron-error" role="alert">{error}</p>}{notice&&<p className="metron-notice" role="status"><Check size={15}/>{notice}</p>}
  <Attribution/>
 </section>;
}
