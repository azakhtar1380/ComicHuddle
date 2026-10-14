'use client';
import { useState } from 'react';
export default function SignOut() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <main className="auth-shell"><section className="form-dialog auth-card"><h1>SEE YOU<br/><span>NEXT ISSUE.</span></h1><p>Sign out of your ComicHuddle account on this device.</p>{error && <p role="alert">{error}</p>}<button className="button red" disabled={busy} onClick={async () => {
    setBusy(true);try { const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });if (!response.ok) throw Error('Could not sign out.');window.location.assign('/'); } catch (e) { setError(e instanceof Error ? e.message : 'Try again.');setBusy(false); }
  }}>Sign out</button><a className="inline-button auth-switch" href="/">Return to my collection</a></section></main>;
}
