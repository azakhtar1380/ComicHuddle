'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, Clock3, Database, Pause, Play, RefreshCw, Settings2} from 'lucide-react';
import './catalog-sync-panel.css';

type SyncStatus = {
  configured: boolean; accessReady: boolean; imported: number; active: boolean;
  stage: string; pending: number; nextPage: number; lastCompletedAt: string | null;
  retryAfter: number; error: string | null; scope?: Scope;
  schedulerEnabled?: boolean; pausedByOwner?: boolean;
};
type Props = {onUpdated: () => void; notify: (message: string) => void};
type SyncAction = 'start' | 'step' | 'pause' | 'seed_starter';
type Scope = {publisherName?: string; startDate?: string; endDate?: string};
function statusOf(value: unknown): SyncStatus {
  if (!value || typeof value !== 'object') throw Error('Import status is unavailable. Refresh and try again.');
  const status = value as Partial<SyncStatus>;
  if (typeof status.configured !== 'boolean' || typeof status.accessReady !== 'boolean' || typeof status.active !== 'boolean' || typeof status.stage !== 'string' ||
      ![status.imported, status.pending, status.nextPage].every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) ||
      typeof status.retryAfter !== 'number' || !Number.isFinite(status.retryAfter) || status.retryAfter < 0 ||
      (status.schedulerEnabled !== undefined && typeof status.schedulerEnabled !== 'boolean') ||
      (status.pausedByOwner !== undefined && typeof status.pausedByOwner !== 'boolean') ||
      (status.lastCompletedAt !== null && typeof status.lastCompletedAt !== 'string') || (status.error !== null && typeof status.error !== 'string') ||
      (status.scope !== undefined && (!status.scope || typeof status.scope !== 'object' || Array.isArray(status.scope) || Object.values(status.scope).some(value => typeof value !== 'string')))) {
    throw Error('Import status returned an incomplete response. Refresh and try again.');
  }
  return status as SyncStatus;
}
function completedAt(value: string | null) {
  if (!value) return 'No completed pass yet';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? 'Timestamp unavailable' : stamp.toLocaleString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC'}) + ' UTC';
}
function errorText(body: unknown, fallback: string) {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : fallback;
}

export default function CatalogSyncPanel({onUpdated, notify}: Props) {
  const [status, setStatus] = useState<SyncStatus | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState<SyncAction | null>(null), [error, setError] = useState('');
  const [publisherName, setPublisherName] = useState('Marvel'), [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState('');
  const [retryUntil, setRetryUntil] = useState(0), [clock, setClock] = useState(Date.now());
  const mounted = useRef(false), generation = useRef(0), reading = useRef<AbortController | null>(null), writing = useRef(false);
  const callbacks = useRef({onUpdated, notify}); callbacks.current = {onUpdated, notify};
  function applyStatus(next: SyncStatus) {
    setStatus(next); setClock(Date.now()); setRetryUntil(next.retryAfter > 0 ? Date.now() + next.retryAfter * 1000 : 0);
    if (next.scope && (next.active || next.stage === 'paused')) {setPublisherName(next.scope.publisherName || ''); setStartDate(next.scope.startDate || ''); setEndDate(next.scope.endDate || '');}
  }
  function applyRetry(body: unknown, response: Response) {
    const value = body && typeof body === 'object' && 'retryAfter' in body ? Number(body.retryAfter) : Number(response.headers.get('Retry-After'));
    if (Number.isFinite(value) && value > 0) {setClock(Date.now()); setRetryUntil(Date.now() + value * 1000);}
  }
  async function refresh() {
    if (writing.current) return;
    reading.current?.abort();
    const request = ++generation.current, abort = new AbortController(); reading.current = abort;
    const current = () => mounted.current && generation.current === request && !abort.signal.aborted;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/catalog-sync', {signal: abort.signal, cache: 'no-store', credentials: 'same-origin'}), body: unknown = await response.json();
      if (!current()) return;
      if (!response.ok) {applyRetry(body, response); throw Error(errorText(body, 'Could not read the import checkpoint.'));}
      applyStatus(statusOf(body));
    } catch (problem) {if (current()) setError(problem instanceof Error ? problem.message : 'Could not read the import checkpoint.');}
    finally {if (current()) setLoading(false);}
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => {mounted.current = false; generation.current++; reading.current?.abort();};
    // Only read status on mounting or explicit Refresh; no unattended import calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = setInterval(() => {
      const now = Date.now(); setClock(now);
      if (now >= retryUntil) {setRetryUntil(0); clearInterval(timer);}
    }, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);

  async function action(name: SyncAction, scope?: Scope) {
    if (writing.current) return;
    writing.current = true; reading.current?.abort();
    const request = ++generation.current, previousImported = status?.imported || 0, wasPausedByOwner = status?.pausedByOwner === true;
    const current = () => mounted.current && generation.current === request;
    setLoading(false); setBusy(name); setError('');
    try {
      const response = await fetch('/api/catalog-sync', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({action: name, ...(scope ? {scope} : {})})});
      const body: unknown = await response.json();
      if (!current()) return;
      if (!response.ok) {applyRetry(body, response); throw Error(errorText(body, 'Could not update the import checkpoint.'));}
      const next = statusOf(body); applyStatus(next);
      const added = Math.max(0, next.imported - previousImported);
      callbacks.current.notify(name === 'start' ? 'Import checkpoint created. Continue import to load a bounded batch.' : name === 'pause' ? next.pausedByOwner ? 'Manual and nightly imports paused; saved progress is retained.' : 'Catalog import checkpoint updated.' : name === 'seed_starter' ? 'Starter bibliography loaded into shared storage.' : wasPausedByOwner && next.pausedByOwner === false ? 'Import resumed; the manual and nightly pause is cleared.' : added > 0 ? `${added} additional Metron records stored.` : 'Import checkpoint updated.');
      if (name === 'step' || name === 'seed_starter') callbacks.current.onUpdated();
    } catch (problem) {
      if (current()) {
        setError(problem instanceof Error ? problem.message : 'Could not update the import checkpoint.');
        // A failed bounded step can still leave a saved checkpoint or retry delay.
        // Read it without retrying the write or losing the original action error.
        const abort = new AbortController(); reading.current = abort;
        try {
          const response = await fetch('/api/catalog-sync', {signal: abort.signal, cache: 'no-store', credentials: 'same-origin'}), body: unknown = await response.json();
          if (current() && !abort.signal.aborted && response.ok) {
            applyStatus(statusOf(body));
            if (name === 'step' || name === 'seed_starter') callbacks.current.onUpdated();
          }
        } catch {/* Keep the action error visible; the owner can refresh later. */}
      }
    }
    finally {writing.current = false; if (current()) setBusy(null);}
  }
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !ready || scopeLocked || seconds > 0) return;
    if (startDate && endDate && startDate > endDate) {setError('The start date must be on or before the end date.'); return;}
    const scope: Scope = {};
    if (publisherName.trim()) scope.publisherName = publisherName.trim();
    if (startDate) scope.startDate = startDate;
    if (endDate) scope.endDate = endDate;
    void action('start', scope);
  }
  const seconds = Math.max(0, Math.ceil((retryUntil - clock) / 1000));
  const ready = Boolean(status?.configured && status.accessReady), complete = status?.stage === 'complete' || status?.stage === 'completed';
  const hasCheckpoint = Boolean(status && status.stage !== 'idle' && !complete);
  const disabled = loading || Boolean(busy), scopeLocked = Boolean(status?.active || status?.stage === 'paused');
  const canPause = Boolean(status && (status.active || status.stage === 'paused') && !status.pausedByOwner);
  const nightlyStatus = status?.schedulerEnabled === true ? 'Nightly task linked. Provider configuration and a chosen initial import scope are still required.' : status?.schedulerEnabled === false ? 'Nightly synchronization is prepared but not enabled. Manual imports remain available.' : loading ? 'Checking nightly task status…' : 'Nightly task status is unavailable. Refresh to check.';
  return <div className="catalog-sync-panel">
    <div className="cs-heading"><div><div className="eyebrow">OWNER ONLY / CENTRAL CATALOG</div><h2>ONE CONNECTION.<br/><span>EVERY COLLECTOR.</span></h2><p>Import Metron metadata into the shared database. Visitors search stored records without provider accounts or tokens.</p></div><Database size={37}/></div>
    <div className="cs-metrics" aria-live="polite"><div><strong>{status ? status.imported.toLocaleString('en-US') : '—'}</strong><span>METRON RECORDS STORED</span></div><div><strong>{status ? status.pending.toLocaleString('en-US') : '—'}</strong><span>DETAIL RECORDS QUEUED</span></div><div><strong>{status ? status.nextPage : '—'}</strong><span>PAGE CURSOR</span></div></div>
    <div className="cs-state-row"><div className={'cs-status ' + (status?.active ? 'cs-active' : '')}><span/><strong>{loading ? 'Reading checkpoint…' : status ? status.active ? 'Checkpoint in progress' : complete ? 'Import pass completed' : status.stage === 'paused' ? 'Checkpoint paused' : status.stage === 'idle' ? 'Importer idle' : 'Checkpoint stopped' : 'Status unavailable'}</strong>{status && <small>Stage: {status.stage.replace(/[_-]/g, ' ')}</small>}</div><button type="button" className="button outline" disabled={disabled} onClick={() => void refresh()}><RefreshCw size={15}/> Refresh status</button></div>
    <p className="cs-last-pass">Last completed pass: {status ? completedAt(status.lastCompletedAt) : loading ? 'Checking history…' : 'History unavailable'}. A completed pass covers its selected scope; it does not establish a complete catalog.</p>
    {status?.scope && <p className="cs-help">Saved import scope: {status.scope.publisherName || 'All publishers'}{status.scope.startDate ? ' · from ' + status.scope.startDate : ''}{status.scope.endDate ? ' · through ' + status.scope.endDate : ''}.</p>}
    <div className="cs-workspace"><div>
      <form onSubmit={start} className="cs-form"><div className="eyebrow">CHOOSE AN IMPORT SCOPE</div><h3>Start with a publisher. Build from there.</h3><p>Marvel is a useful starting scope. Leave the publisher blank for an eventual backfill across all publishers, completed over successive batches.</p><label>Publisher<input value={publisherName} onChange={event => setPublisherName(event.target.value)} maxLength={100} placeholder="Marvel, DC, Image… or leave blank" disabled={disabled || scopeLocked}/></label><div className="cs-date-fields"><label>Start date <small>Optional</small><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} disabled={disabled || scopeLocked}/></label><label>End date <small>Optional</small><input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} disabled={disabled || scopeLocked}/></label></div><p className="cs-help">Dates filter the provider's store-date range. Starting creates a checkpoint; it does not load the entire catalog at once.</p><button type="submit" className="button red" disabled={disabled || !ready || scopeLocked || seconds > 0}>{busy === 'start' ? 'Starting…' : 'Start import'} <ArrowRight size={16}/></button>{scopeLocked && <p className="cs-help">Resume and finish the existing checkpoint before starting another scope.</p>}</form>
      <div className="cs-controls"><div><Play size={22}/><div><h3>Continue at your pace.</h3><p>Each click imports one bounded chunk and stores the checkpoint. Pause stops manual and nightly imports. Resume import clears that pause.</p></div></div><div className="actions"><button type="button" className="button dark" disabled={disabled || !ready || !hasCheckpoint || seconds > 0} onClick={() => void action('step')}><Play size={15}/>{busy === 'step' ? 'Importing this batch…' : status?.stage === 'paused' ? 'Resume import' : 'Continue import'}</button><button type="button" className="button outline" disabled={disabled || !canPause} onClick={() => void action('pause')}><Pause size={15}/>{busy === 'pause' ? 'Pausing…' : 'Pause'}</button></div>{seconds > 0 && <p className="cs-retry" role="status"><Clock3 size={15}/> Provider retry delay: {seconds.toLocaleString('en-US')} seconds remaining.</p>}<p className="cs-help" role="status">{nightlyStatus}</p>{status?.pausedByOwner && <p className="cs-help">Your manual pause is active, including nightly imports. Resume import clears the pause.</p>}</div>
    </div><aside className="cs-setup"><Settings2 size={27}/><h3>GET READY ON THE SERVER.</h3><ul className="cs-checks"><li>{status?.configured ? <CheckCircle2 size={16}/> : <Clock3 size={16}/>}<div><strong>Business token</strong><span>{status ? status.configured ? 'Configured on the server' : 'Not configured yet' : 'Checking configuration…'}</span></div></li><li>{status?.accessReady ? <CheckCircle2 size={16}/> : <Clock3 size={16}/>}<div><strong>Sync activation</strong><span>{status ? status.accessReady ? 'Enabled and ready' : 'Awaiting server setup or activation' : 'Checking activation…'}</span></div></li></ul><p>Use a business-owned Metron account for the central import. Review Metron’s account arrangement and commercial-use guidance for this platform.</p><p>Set <code>METRON_API_TOKEN</code> as a secret in Sites runtime settings. Set <code>METRON_SYNC_ENABLED=true</code> when the operator is ready to enable imports. Credentials stay on the server.</p><p className="cs-help">This panel never asks for a token. Configuration readiness is not a claim that provider access has been tested or legal clearance obtained.</p><a href="https://metron-project.github.io/blog/token-authentication" target="_blank" rel="noreferrer" className="inline-button">Metron token setup <ArrowUpRight size={14}/></a><a href="https://metron-project.github.io/blog/commercial-api-use" target="_blank" rel="noreferrer" className="inline-button">Metron business-use guidance <ArrowUpRight size={14}/></a><div className="cs-rights"><BookOpen size={20}/><p>Imported metadata keeps Metron attribution and CC BY-SA 4.0 licensing. Cover images and FMV are handled separately; this sync imports neither.</p></div></aside></div>
    {(error || status?.error) && <p className="cs-error" role="alert">{error || status?.error}</p>}
    <div className="cs-starter"><div><strong>Load the credited starter bibliography</strong><p>Stores the starter issue records without contacting the provider. Metron counts above exclude these records.</p></div><button type="button" className="button outline" disabled={disabled || !status} onClick={() => void action('seed_starter')}><BookOpen size={15}/>{busy === 'seed_starter' ? 'Loading…' : 'Load starter bibliography'}</button></div>
  </div>;
}
