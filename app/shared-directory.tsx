'use client';

import {useEffect, useRef, useState} from 'react';
import {ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Filter, Grid3X3, List, RefreshCw, Search} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import type {CollectionEntry} from '../lib/collection-entry';
import './shared-directory.css';
import CatalogFmv from './catalog-fmv';
import ComicPicker from './comic-picker';
import DirectoryTree from './directory-tree';

type CatalogPage = {
  issues: Issue[]; total: number; limit: number; offset: number; hasMore: boolean;
  issueCount: number; scope: 'starter' | 'shared'; syncedIssueCount: number;
  lastSyncedAt: string | null; publishers: string[];
  gcdIssueCount?: number; gcdIndexIssueCount?: number; coverIssueCount?:number; lastGcdSyncedAt?: string | null;
};
type Props = {onOpen: (issue: Issue) => void; onWant: (issue: Issue) => void; onCollect:(issue:Issue,entry?:CollectionEntry,requestId?:string)=>Promise<void>|void; beforeCollection?:()=>boolean; activeListingCounts?:Record<number,number>|null; onFind:(issue:Issue)=>void; ownedIds:number[]; wantedIds: number[]; saving: boolean};
const pageSize = 12;
const eras = ['Golden Age', 'Silver Age', 'Bronze Age', 'Copper Age', 'Modern Age'];
const kinds = ['First appearance', 'Key issue', 'Cover spotlight', 'Series debut', 'Run builder', 'Catalog issue'];
function DirectoryIssueCard({issue,onOpen}:{issue:Issue;onOpen:(issue:Issue)=>void}) {
  const [coverFailed,setCoverFailed]=useState(false);
  useEffect(()=>setCoverFailed(false),[issue.cover]);
  return <button type="button" className="sd-card" aria-haspopup="dialog" aria-label={'More info about '+issue.title+' #'+issue.number+' · '+issue.publisher} onClick={()=>onOpen(issue)}>
    <span className="sd-art">{issue.cover&&!coverFailed?<img src={issue.cover} alt={issue.title+' #'+issue.number+' cover'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setCoverFailed(true)}/>:<span className="sd-cover-empty" role="img" aria-label="Cover unavailable"><BookOpen size={36} aria-hidden="true"/><small>Cover unavailable</small></span>}</span>
    {issue.cover&&<span className="sd-cover-credit">{issue.gcdId?'Cover image source: Grand Comics Database (GCD) / Publisher':'Cover: Wikimedia Commons · US public domain'}</span>}
    <span className="sd-info"><strong className="sd-title">{issue.title} <span>#{issue.number}</span></strong><span className="sd-publisher">{issue.publisher}</span><CatalogFmv issueId={issue.id}/><span className="sd-more">More info <ArrowUpRight size={14} aria-hidden="true"/></span></span>
  </button>;
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

export default function SharedDirectory({onOpen}: Props) {
  const [series,setSeries]=useState(''),[matched,setMatched]=useState<Issue|null>(null);
  const [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState('');
  const [publisher, setPublisher] = useState(''), [era, setEra] = useState(''), [kind, setKind] = useState(''), [sort, setSort] = useState('featured');
  const [offset, setOffset] = useState(0), [list, setList] = useState(false), [retry, setRetry] = useState(0);
  const [data, setData] = useState<CatalogPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  function invalidate() {generation.current++; controller.current?.abort(); setLoading(true); setError('');}
  function changeQuery(value: string) {if (value === query) return; invalidate(); setQuery(value); setOffset(0);}
  function changeFilter(set: (value: string) => void, value: string) {invalidate(); set(value); setOffset(0); setRetry(count => count + 1);}
  function resetFilters() {invalidate(); setQuery(''); setPublisher(''); setSeries(''); setMatched(null); setEra(''); setKind(''); setSort('featured'); setOffset(0); setRetry(value => value + 1);}

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
    const params = new URLSearchParams({q: debouncedQuery.trim(), limit: String(pageSize), offset: String(offset), sort});
    if (publisher) params.set('publisher', publisher);
    if (series) params.set('series',series);
    if (era) params.set('era', era);
    if (kind) params.set('kind', kind);
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
      } catch (problem) {
        if (current()) setError(problem instanceof Error ? problem.message : 'The directory is unavailable. Please retry.');
      } finally {if (current()) setLoading(false);}
    })();
    return () => {abort.abort(); if (generation.current === request) generation.current++;};
  }, [query, debouncedQuery, publisher, series, era, kind, sort, offset, retry]);

  const publisherOptions = [...new Set([...(data?.publishers || []), ...(publisher ? [publisher] : [])])];
  const pageNumber = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return <section className="shared-directory directory-page">
    <div className="page-intro"><div><div className="eyebrow">THE SHARED COMIC DIRECTORY</div><h1>FIND THE ISSUE.<br/><span>FOLLOW THE STORY.</span></h1><p>Search series, issue numbers, characters, publishers and creators. One directory for every collector.</p></div><div className="index-stamp"><strong>{data ? data.issueCount.toLocaleString('en-US') : '—'}</strong><span>INDEXED ISSUES<br/>{data ? data.scope === 'shared' ? 'SHARED CATALOG' : 'STARTER BIBLIOGRAPHY' : 'CHECKING COVERAGE'}</span></div></div>
    <div className="sd-coverage" aria-live="polite"><BookOpen size={19}/><div>{data ? <><strong>{data.scope === 'shared' ? 'A growing shared index' : 'The starter bibliography'}</strong><p>{data.issueCount.toLocaleString('en-US')} indexed records · {data.syncedIssueCount.toLocaleString('en-US')} from Metron{data.gcdIssueCount!==undefined&&<> · {data.gcdIssueCount.toLocaleString('en-US')} imported from GCD</>}. {data.syncedIssueCount > 0 ? 'Last completed Metron import: ' + syncedDate(data.lastSyncedAt) + '. ' : ''}{data.gcdIssueCount&&data.lastGcdSyncedAt?'Latest GCD record update: '+syncedDate(data.lastGcdSyncedAt)+'. ':''}{(data.gcdIndexIssueCount||0)>0&&<>{data.gcdIndexIssueCount!.toLocaleString('en-US')} entries have issue and edition identifiers; publication and story details await enrichment. </>}Coverage is still growing; this is not a complete comic catalog.</p></> : <><strong>Checking catalog coverage</strong><p>Coverage and record counts load from the shared directory.</p></>}</div></div>
    <div className="sd-quick-find"><ComicPicker key={publisher+'|'+series} value={matched} label="Search the comic directory" onQueryChange={changeQuery} onChange={issue=>{setMatched(issue);if(issue)onOpen(issue)}}/></div>
    <div className="sd-browser"><DirectoryTree key={publisher} publishers={publisherOptions} publisher={publisher} series={series} onPublisher={value=>{invalidate();setPublisher(value);setSeries('');setQuery('');setMatched(null);setOffset(0)}} onSeries={value=>{invalidate();setSeries(value);setQuery('');setMatched(null);setOffset(0)}}/><div className="sd-browser-main">
    <div className="sd-filters">
      <label><span><Filter size={13}/> Publisher</span><select aria-label="Filter publisher" value={publisher} onChange={event => {setSeries('');changeFilter(setPublisher, event.target.value)}}><option value="">All publishers</option>{publisherOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>Era</span><select aria-label="Filter era" value={era} onChange={event => changeFilter(setEra, event.target.value)}><option value="">All eras</option>{eras.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>Issue type</span><select aria-label="Filter issue type" value={kind} onChange={event => changeFilter(setKind, event.target.value)}><option value="">All types</option>{kinds.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="sd-sort"><span>Sort</span><select aria-label="Sort directory" value={sort} onChange={event => changeFilter(setSort, event.target.value)}><option value="featured">Featured</option><option value="title">Title A–Z</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
      <div className="sd-view-toggle" aria-label="Directory layout"><button type="button" aria-label="Grid view" aria-pressed={!list} className={!list ? 'active' : ''} onClick={() => setList(false)}><Grid3X3 size={18}/></button><button type="button" aria-label="List view" aria-pressed={list} className={list ? 'active' : ''} onClick={() => setList(true)}><List size={18}/></button></div>
    </div>
    <div className="sd-results-caption"><span role="status">{loading ? 'Searching the shared directory…' : error ? 'Directory unavailable' : data?.total ? `Showing ${data.offset + 1}–${data.offset + data.issues.length} of ${data.total.toLocaleString('en-US')} matches` : 'No matching issues'}</span><span>Confirm edition and printing before collecting.</span></div>
    <div className="sd-results" aria-busy={loading}>
      {loading ? <div className="sd-state"><RefreshCw size={28}/><h2>Opening the longbox…</h2><p>Loading stored issue records.</p></div> : error ? <div className="sd-state sd-error" role="alert"><BookOpen size={30}/><h2>The index is taking a pause.</h2><p>{error}</p><button type="button" className="button red" onClick={() => {invalidate(); setRetry(value => value + 1);}}><RefreshCw size={16}/> Retry directory</button></div> : data?.issues.length ? <div className={list ? 'sd-list' : 'sd-grid'}>
        {data.issues.map(issue=><DirectoryIssueCard key={issue.id} issue={issue} onOpen={onOpen}/>)}
      </div> : <div className="sd-state"><Search size={32}/><h2>{data?.issueCount === 0 ? 'The shared shelves are waiting.' : 'No match in the stored index.'}</h2><p>{data?.issueCount === 0 ? 'No bibliography has been loaded yet. Catalog coverage will appear here after an owner import.' : 'Try another series, creator or filter. You can still enter an unindexed comic manually in My collection.'}</p>{data && data.issueCount > 0 && <button type="button" className="button outline" onClick={resetFilters}>Clear search and filters</button>}</div>}
    </div>
    {!loading && !error && data && data.total > data.limit && <nav className="sd-pagination" aria-label="Directory pages"><button type="button" disabled={data.offset === 0} onClick={() => {invalidate(); setOffset(Math.max(0, data.offset - data.limit));}}><ChevronLeft size={18}/> Previous</button><span>Page {pageNumber} of {totalPages.toLocaleString('en-US')}</span><button type="button" disabled={!data.hasMore} onClick={() => {invalidate(); setOffset(data.offset + data.limit);}}>Next <ChevronRight size={18}/></button></nav>}
    </div></div>
    <div className="sd-attribution"><BookOpen size={20}/><div>{data && data.syncedIssueCount > 0 && <p>Comic metadata adapted from <a href="https://metron.cloud/" target="_blank" rel="noreferrer">Metron</a> for this shared index, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Adapted Metron metadata retains that license.</p>}{data && (data.gcdIssueCount||0)>0&&<p>Comic metadata adapted from the <a href="https://www.comics.org/" target="_blank" rel="noreferrer">Grand Comics Database</a> for this shared index, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Adapted GCD metadata retains that license.</p>}<p>Cover thumbnails identify the indexed edition. Artwork © the respective publishers and artists; the metadata license does not include artwork. Starter records retain their individual source credits. {data?.coverIssueCount!==undefined&&<>{data.coverIssueCount.toLocaleString('en-US')} records have a cover reference; source availability varies.</>}</p></div></div>
  </section>;
}
