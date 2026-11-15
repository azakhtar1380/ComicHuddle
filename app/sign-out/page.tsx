'use client';
import Link from 'next/link';
import {useState} from 'react';
import {AlertCircle,LogOut} from 'lucide-react';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import HuddlesGuide from '../../components/huddles-guide';
import '../sign-in/sign-in.css';

export default function SignOut() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function signOut() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw Error('Couldn’t sign you out. Try again.'); window.location.assign('/'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t sign you out. Try again.'); setBusy(false); }
  }
  return <div className="auth-page">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <SiteHeader section="Account" standalone/>
    <main id="main-content" tabIndex={-1} className="ds-wrap signout-v2">
      <div className="signout-v2-layout">
        <HuddlesGuide pose="sign-out" caption="TO BE CONTINUED…" size="lg"/>
        <section aria-labelledby="signout-title">
          <p className="ds-eyebrow">Sign out</p>
          <h1 id="signout-title" className="auth-v2-title">See you <span>next issue.</span></h1>
          <p className="auth-v2-lede">Your collection, wants and orders stay saved.</p>
          {error && <p role="alert" className="ds-error"><AlertCircle size={18} aria-hidden="true"/> {error}</p>}
          <div className="ds-actions">
            <button type="button" className="ds-btn ds-btn-primary" disabled={busy} onClick={() => void signOut()}><LogOut size={18} aria-hidden="true"/>{busy ? 'Signing out…' : 'Sign out'}</button>
            <Link className="ds-link" href="/">Stay signed in</Link>
          </div>
        </section>
      </div>
    </main>
    <SiteFooter/>
  </div>;
}
