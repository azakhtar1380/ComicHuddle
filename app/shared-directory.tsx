'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {Check, ChevronLeft, ChevronRight, Grid3X3, List, Plus, SlidersHorizontal, X} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import type {CollectionEntry} from '../lib/collection-entry';
import './shared-directory.css';
import ResolvedComicCover from './resolved-comic-cover';
import ComicPicker from './comic-picker';
import DirectoryTree from './directory-tree';
import PublisherFilter from './publisher-filter';
import {Portrait} from './issue-showcase';
import PageHeader from '../components/page-header';
import {EmptyState, ErrorState, LoadingState} from '../components/states';

type CharacterFilter={id:number;name:string};
type CharacterHit={characterId:number;name:string;portraitUrl:string|null;issueCount:number|null};
/** Deep link from the header: /?section=Directory&character=<id>&cname=<name>. */
function linkedCharacter():CharacterFilter|null{if(typeof window==='undefined')return null;const params=new URLSearchParams(window.location.search),id=Number(params.get('character'));return params.has('character')&&Number.isSafeInteger(id)?{id,name:(params.get('cname')||'Selected character').slice(0,80)}:null}

type CatalogPage = {
  issues: Issue[]; total: number; limit: number; offset: number; hasMore: boolean;
  issueCount: number; scope: 'starter' | 'shared'; syncedIssueCount: number;
  lastSyncedAt: string | null; publishers: string[];
  coverageObservedAt?:string;nativeIssueCountEstimate?:number;nativeSnapshotStatus?:string;gcdIssueCount?: number; gcdIndexIssueCount?: number; coverIssueCount?:number; lastGcdSyncedAt?: string | null;
};
type Props = {onOpen: (issue: Issue) => void; onWant: (issue: Issue) => void; onCollect:(issue:Issue,entry?:CollectionEntry,requestId?:string)=>Promise<void>|void; beforeCollection?:()=>boolean; activeListingCounts?:Record<number,number>|null; onFind:(issue:Issue)=>void; ownedIds:number[]; wantedIds: number[]; saving: boolean};
const pageSize = 12;
const eras = ['Golden Age', 'Silver Age', 'Bronze Age', 'Copper Age', 'Modern Age'];
const kinds = ['First appearance', 'Key issue', 'Cover spotlight', 'Series debut', 'Run builder', 'Catalog issue'];
/** Per-card save state for "Add to my collection": saving, saved, or an error line. */
type AddState='saving'|'saved'|{error:string};
function DirectoryIssueCard({issue,onOpen,owned,state,disabled,onAdd}:{issue:Issue;onOpen:(issue:Issue)=>void;owned:boolean;state?:AddState;disabled:boolean;onAdd:(issue:Issue)=>void}) {
 const label=issue.title+' #'+issue.number,year=issue.year>0?issue.year:null,problem=state&&typeof state==='object'?state.error:'';
 return <article className="sd-card">
  <button type="button" className="sd-card-main" aria-haspopup="dialog" aria-label={'Open details for '+label+' · '+issue.publisher+(year?' · '+year:'')} onClick={()=>onOpen(issue)}>
   <span className="sd-art"><ResolvedComicCover issueId={issue.id} title={issue.title} issue={issue.number} publisher={issue.publisher} year={issue.year} src={issue.cover} credit={issue.coverCredit}/></span>
   <span className="sd-info"><strong className="sd-title">{issue.title} <span>#{issue.number}</span></strong><span className="sd-publisher">{issue.publisher}{year?' · '+year:''}</span></span>
  </button>
  <div className="sd-card-actions">
   {state==='saved'?<p className="sd-added" role="status"><Check size={16} aria-hidden="true"/> In your collection</p>
    :<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm sd-add" disabled={disabled||state==='saving'} aria-label={(owned?'Add another copy of ':'Add to my collection: ')+label} onClick={()=>onAdd(issue)}>{state==='saving'?'Adding…':<><Plus size={16} aria-hidden="true"/> {owned?'Add another copy':'Add to my collection'}</>}</button>}
   {problem&&<p className="ds-error sd-add-error" role="alert"><X size={14} aria-hidden="true"/> {problem}</p>}
  </div>
 </article>;
}

function syncedDate(value: string | null) {
  if (!value) return 'No completed pass yet';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? 'Timestamp unavailable' : stamp.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
}
function catalogPage(value: unknown): CatalogPage {
  if (!value || typeof value !== 'object') throw Error('The directory returned an unreadable response. Please retry.');
  const data = value as Partial<CatalogPage>;
  if (!Array.isArray(data.issues) || !Array.isArray(data.publishers) ||
      ![data.total, data.limit, data.offset, data.issueCount, data.syncedIssueCount].every(number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0) ||
      !data.limit || data.limit > 30 || data.issues.length > data.limit || typeof data.hasMore !== 'boolean' ||
      (data.scope !== 'starter' && data.scope !== 'shared') || (data.lastSyncedAt !== null && typeof data.lastSyncedAt !== 'string') ||
      (data.gcdIssueCount !== undefined && (!Number.isSafeInteger(data.gcdIssueCount) || data.gcdIssueCount < 0)) ||
      (data.gcdIndexIssueCount !== undefined && (!Number.isSafeInteger(data.gcdIndexIssueCount) || data.gcdIndexIssueCount < 0 || data.gcdIndexIssueCount > (data.gcdIssueCount || 0))) ||
      (data.coverIssueCount !== undefined && (!Number.isSafeInteger(data.coverIssueCount) || data.coverIssueCount < 0 || data.coverIssueCount > (data.issueCount || 0))) ||
      (data.lastGcdSyncedAt !== undefined && data.lastGcdSyncedAt !== null && typeof data.lastGcdSyncedAt !== 'string') ||
      data.publishers.some(name => typeof name !== 'string') ||
      data.issues.some(issue => !issue || !Number.isSafeInteger(issue.id) || issue.id < 0 || !Number.isInteger(issue.year) ||
        [issue.title, issue.number, issue.publisher, issue.era, issue.note, issue.kind, issue.variant, issue.source].some(field => typeof field !== 'string'))) {
    throw Error('The directory returned an incomplete response. Please retry.');
  }
  return data as CatalogPage;
}

export default function SharedDirectory({onOpen, onCollect, beforeCollection, ownedIds, saving}: Props) {
  const [sheet,setSheet]=useState(false),[adding,setAdding]=useState<Record<number,AddState>>({});
  const root=useRef<HTMLElement>(null),filtersRef=useRef<HTMLDivElement>(null);
  const owned=useMemo(()=>new Set(ownedIds),[ownedIds]);
  // Uses the same save path as the issue dialog: hub's collect() via onCollect, after the account gate.
  async function addToCollection(issue:Issue){
    if(adding[issue.id]==='saving')return;
    if(beforeCollection&&!beforeCollection())return;
    setAdding(state=>({...state,[issue.id]:'saving'}));
    try{await onCollect(issue);setAdding(state=>({...state,[issue.id]:'saved'}))}
    catch{setAdding(state=>({...state,[issue.id]:{error:'Couldn’t add it. Try again.'}}))}
  }
  // Mobile: the search sticks under the site header, whatever height it wraps to.
  useEffect(()=>{const header=document.querySelector('.site-header'),target=root.current;if(!header||!target)return;const measure=()=>target.style.setProperty('--sd-header',Math.round(header.getBoundingClientRect().height)+'px');measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(header);return()=>observer.disconnect()},[]);
  // Mobile filter sheet: Escape closes it, focus moves into it.
  useEffect(()=>{if(!sheet)return;filtersRef.current?.querySelector<HTMLElement>('.sd-sheet-close')?.focus({preventScroll:true});const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setSheet(false)};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[sheet]);
  const [series,setSeries]=useState(''),[matched,setMatched]=useState<Issue|null>(null);
  // Header search deep link: /?section=Directory&q=... (Directory only mounts client-side after navigation)
  const linked = () => typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('q') || '').trim().slice(0, 120);
  const [query, setQuery] = useState(linked), [debouncedQuery, setDebouncedQuery] = useState(linked);
  const [character,setCharacter]=useState<CharacterFilter|null>(linkedCharacter),[characterHits,setCharacterHits]=useState<{q:string;hits:CharacterHit[]}>({q:'',hits:[]});
  const [publisher, setPublisher] = useState(''), [era, setEra] = useState(''), [kind, setKind] = useState(''), [sort, setSort] = useState('featured');
  const [offset, setOffset] = useState(0), [list, setList] = useState(false), [retry, setRetry] = useState(0);
  const [data, setData] = useState<CatalogPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const cursors=useRef(new Map<number,number>());
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  function invalidate() {generation.current++; controller.current?.abort(); setLoading(true); setError('');}
  function changeQuery(value: string) {if (value === query) return; invalidate(); setQuery(value); setOffset(0);}
  function changeFilter(set: (value: string) => void, value: string) {invalidate(); set(value); setOffset(0); setRetry(count => count + 1);}
  function resetFilters() {invalidate(); setCharacter(null); setQuery(''); setPublisher(''); setSeries(''); setMatched(null); setEra(''); setKind(''); setSort('featured'); setOffset(0); setRetry(value => value + 1);}

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    // Input events invalidate immediately; no old response may appear during debounce.
    if (query !== debouncedQuery) return;
    const request = ++generation.current, abort = new AbortController();
    controller.current = abort;
    const current = () => generation.current === request && !abort.signal.aborted;
    if(offset===0)cursors.current.clear();
    const params = new URLSearchParams({q: debouncedQuery.trim(), limit: String(pageSize), offset: String(offset), sort});
    if(sort==='featured'&&offset>0&&cursors.current.has(offset))params.set('after',String(cursors.current.get(offset)));
    if (publisher) params.set('publisher', publisher);
    if (series) params.set('series',series);
    if (era) params.set('era', era);
    if (kind) params.set('kind', kind);
    if (character) params.set('character', String(character.id));
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await fetch('/api/catalog?' + params, {signal: abort.signal, cache: 'no-store', credentials: 'same-origin'});
        const body: unknown = await response.json();
        if (!current()) return;
        if (!response.ok) throw Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The directory is unavailable. Please retry.');
        const page = catalogPage(body);
        if (page.offset !== offset) throw Error('The directory returned another page. Please retry.');
        setData(page);
        if(page.hasMore&&page.issues.length)cursors.current.set(page.offset+page.limit,page.issues[page.issues.length-1].id);
      } catch (problem) {
        if (current()) setError(problem instanceof Error ? problem.message : 'The directory is unavailable. Please retry.');
      } finally {if (current()) setLoading(false);}
    })();
    return () => {abort.abort(); if (generation.current === request) generation.current++;};
  }, [query, debouncedQuery, publisher, series, era, kind, sort, offset, retry, character]);
  // Characters matching the typed search, offered as one-tap filters.
  useEffect(()=>{const q=debouncedQuery.trim();if(q.length<2||character)return;const abort=new AbortController();
    fetch('/api/characters/search?'+new URLSearchParams({q,limit:'6'}),{signal:abort.signal}).then(r=>r.ok?r.json():null).then(body=>{if(!abort.signal.aborted)setCharacterHits({q,hits:Array.isArray(body?.characters)?body.characters:[]})}).catch(()=>undefined);
    return()=>abort.abort()},[debouncedQuery,character]);
  function chooseCharacter(next:CharacterFilter|null){invalidate();setCharacter(next);setQuery('');setMatched(null);setOffset(0);const url=new URL(window.location.href);if(next){url.searchParams.set('character',String(next.id));url.searchParams.set('cname',next.name)}else{url.searchParams.delete('character');url.searchParams.delete('cname')}url.searchParams.delete('q');window.history.replaceState(window.history.state,'',url)}
  const shownHits=!character&&characterHits.q===debouncedQuery.trim()&&debouncedQuery.trim().length>=2?characterHits.hits:[];

  const publisherOptions = useMemo(()=>{const available=[...new Set([...(data?.publishers||[]),...(publisher?[publisher]:[])])];const preferred=['Marvel','DC','DC Comics','Image','Image Comics Inc.','Dark Horse','Dark Horse Comics LLC','IDW Publishing','Boom! Studios','Fiction House'].filter(name=>available.includes(name));const chosen=new Set(preferred);return [...preferred,...available.filter(name=>!chosen.has(name))]},[data?.publishers,publisher]);
  const pageNumber = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const filterCount=[publisher,series,era,kind].filter(Boolean).length;
  const filtered=filterCount>0||!!character||!!query.trim();
  const updated=data?.lastGcdSyncedAt?syncedDate(data.lastGcdSyncedAt):data?.lastSyncedAt?syncedDate(data.lastSyncedAt):'';
  const retryDirectory=()=>{invalidate();setRetry(value=>value+1)};
  return <section ref={root} className="shared-directory directory-page">
    <PageHeader eyebrow="Comic Directory" title="Find any issue." accent="Every era. Every publisher." lede="Search by title, issue, character or creator." pose="directory" caption="THE DIRECTORY" line="Try a character, creator or issue #."/>
    <div className="sd-search" role="search">
      <div className="sd-search-field"><ComicPicker key={publisher+'|'+series} value={matched} label="Search the directory" placeholder="Spider-Man, Claremont, #300…" helper="Pick a suggestion to open it, or browse the results below." initialQuery={query} onQueryChange={changeQuery} onChange={issue=>{setMatched(issue);if(issue)onOpen(issue)}}/></div>
      <button type="button" className="ds-btn ds-btn-secondary sd-filter-toggle" aria-expanded={sheet} aria-controls="sd-filters" onClick={()=>setSheet(true)}><SlidersHorizontal size={18} aria-hidden="true"/> Filters{filterCount>0&&<span className="sd-filter-count" aria-label={filterCount+' active'}>{filterCount}</span>}</button>
    </div>
    {character&&<div className="sd-character-filter" role="status"><span>Showing comics with <strong>{character.name}</strong></span><button type="button" onClick={()=>chooseCharacter(null)} aria-label={'Remove the '+character.name+' filter'}>Clear <X size={16} aria-hidden="true"/></button></div>}
    {shownHits.length>0&&<div className="sd-character-hits" aria-label="Matching characters"><span>Characters</span>{shownHits.map(hit=><button type="button" key={hit.characterId} onClick={()=>chooseCharacter({id:hit.characterId,name:hit.name})}><Portrait name={hit.name} src={hit.portraitUrl} size="sm"/>{hit.name}{hit.issueCount?<small>{hit.issueCount.toLocaleString('en-US')}</small>:null}</button>)}</div>}
    <div className="sd-browser"><DirectoryTree key={publisher} publishers={publisherOptions} publisher={publisher} series={series} onPublisher={value=>{invalidate();setPublisher(value);setSeries('');setQuery('');setMatched(null);setOffset(0)}} onSeries={value=>{invalidate();setSeries(value);setQuery('');setMatched(null);setOffset(0)}}/><div className="sd-browser-main">
    {sheet&&<button type="button" className="sd-sheet-backdrop" aria-label="Close filters" tabIndex={-1} onClick={()=>setSheet(false)}/>}
    <div id="sd-filters" ref={filtersRef} className={'sd-filters'+(sheet?' open':'')} role="group" aria-label="Filters">
      <div className="sd-sheet-head"><h2>Filters</h2><button type="button" className="sd-sheet-close" aria-label="Close filters" onClick={()=>setSheet(false)}><X size={22}/></button></div>
      <PublisherFilter options={publisherOptions} value={publisher} onChange={value=>{setSeries('');changeFilter(setPublisher,value)}}/>
      <label><span>Era</span><select aria-label="Filter era" value={era} onChange={event => changeFilter(setEra, event.target.value)}><option value="">All eras</option>{eras.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>Issue type</span><select aria-label="Filter issue type" value={kind} onChange={event => changeFilter(setKind, event.target.value)}><option value="">All types</option>{kinds.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="sd-sort"><span>Sort</span><select aria-label="Sort directory" value={sort} onChange={event => changeFilter(setSort, event.target.value)}><option value="featured">Featured</option><option value="title">Title A–Z</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
      <div className="sd-view-toggle" role="group" aria-label="Directory layout"><button type="button" aria-label="Grid view" aria-pressed={!list} className={!list ? 'active' : ''} onClick={() => setList(false)}><Grid3X3 size={18}/></button><button type="button" aria-label="List view" aria-pressed={list} className={list ? 'active' : ''} onClick={() => setList(true)}><List size={18}/></button></div>
      <div className="sd-sheet-actions">{filtered&&<button type="button" className="ds-link" onClick={resetFilters}>Clear all</button>}<button type="button" className="ds-btn ds-btn-dark" onClick={()=>setSheet(false)}>{!loading&&data?'Show '+data.total.toLocaleString('en-US')+' result'+(data.total===1?'':'s'):'Show results'}</button></div>
    </div>
    <div className="sd-results-caption"><span role="status">{loading ? 'Searching…' : error ? 'Directory unavailable' : data?.total ? `${data.offset + 1}–${data.offset + data.issues.length} of ${data.total.toLocaleString('en-US')} issues` : 'No matching issues'}</span>{filtered&&!loading&&<button type="button" className="ds-link sd-clear" onClick={resetFilters}>Clear search and filters</button>}</div>
    {!loading&&!error&&!!data?.issues.length&&<p className="sd-edition-note">Make sure the edition and printing match your copy.</p>}
    <div className="sd-results" aria-busy={loading}>
      {loading ? <LoadingState message="Searching the directory…"/> : error ? <ErrorState message="Couldn’t load the directory. Try again." action={{label:'Try again',onClick:retryDirectory}}/> : data?.issues.length ? <div className={list ? 'sd-list' : 'sd-grid'}>
        {data.issues.map(issue=><DirectoryIssueCard key={issue.id} issue={issue} onOpen={onOpen} owned={owned.has(issue.id)} state={adding[issue.id]} disabled={saving} onAdd={issue=>void addToCollection(issue)}/>)}
      </div> : data?.issueCount === 0 ? <EmptyState title="Still filling up" message="The directory is still filling up. Check back soon."/> : <EmptyState title="No luck." message="Try another search, or add the comic by hand." action={{label:'Clear search and filters',onClick:resetFilters}}/>}
    </div>
    {!loading && !error && data && data.total > data.limit && <nav className="sd-pagination" aria-label="Directory pages"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={data.offset === 0} onClick={() => {invalidate(); setOffset(Math.max(0, data.offset - data.limit));}}><ChevronLeft size={18}/> Previous</button><span>Page {pageNumber.toLocaleString('en-US')} of {totalPages.toLocaleString('en-US')}</span><form className="sd-page-jump" onSubmit={event=>{event.preventDefault();const value=Number(new FormData(event.currentTarget).get('page'));if(Number.isInteger(value)&&value>=1&&value<=totalPages){invalidate();setOffset((value-1)*data.limit)}}}><label htmlFor="directory-page-jump">Go to page</label><input id="directory-page-jump" name="page" type="number" min="1" max={totalPages} required inputMode="numeric" defaultValue={pageNumber}/><button type="submit" className="ds-btn ds-btn-secondary ds-btn-sm">Go</button></form><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!data.hasMore} onClick={() => {invalidate(); setOffset(data.offset + data.limit);}}>Next <ChevronRight size={18}/></button></nav>}
    </div></div>
    <footer className="sd-attribution">
      {data&&<p className="sd-coverage">{data.issueCount.toLocaleString('en-US')} issues in the directory{updated?' · Updated '+updated:''}</p>}
      {data && data.syncedIssueCount > 0 && <p>Comic metadata adapted from <a href="https://metron.cloud/" target="_blank" rel="noreferrer">Metron</a>, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Adapted Metron metadata keeps that license.</p>}
      {data && (data.gcdIssueCount||0)>0&&<p>Comic metadata adapted from the <a href="https://www.comics.org/" target="_blank" rel="noreferrer">Grand Comics Database</a>, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Adapted GCD metadata keeps that license.</p>}
      <p>Cover art © its publishers and artists. The metadata license doesn’t cover artwork. Starter records keep their own source credits.{data?.coverIssueCount!==undefined&&<> {data.coverIssueCount.toLocaleString('en-US')} records have a cover so far.</>}</p>
    </footer>
  </section>;
}
