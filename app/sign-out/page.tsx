'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
export default function SignOut() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function signOut() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw Error('We couldn’t sign you out. Please try again.'); window.location.assign('/'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); setBusy(false); }
  }
  return <main className="auth-shell ch-signout">
    <a className="ch-signout-brand" href="/" aria-label="ComicHuddle home"><img src="/brand/comichuddle-hero-logo-compact.svg" alt="ComicHuddle" width="1254" height="1010"/></a>
    <section className="form-dialog auth-card">
      <h1>SEE YOU<br/><span>NEXT ISSUE.</span></h1>
      <p>Sign out of your ComicHuddle account on this device? Your collection, wants and orders stay safely saved.</p>
      {error && <p role="alert" className="network-error">{error}</p>}
      <div className="ch-signout-actions">
        <button type="button" className="ch-btn ch-btn-primary" disabled={busy} onClick={() => void signOut()}><LogOut size={18}/>{busy ? 'Signing out…' : 'Sign out'}</button>
        <a className="ch-btn ch-btn-outline" href="/">Stay signed in</a>
      </div>
    </section>
  </main>;
}
