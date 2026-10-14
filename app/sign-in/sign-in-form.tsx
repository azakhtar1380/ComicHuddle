'use client';
import { useEffect, useState } from 'react';
function returnPath() {
  const value = new URLSearchParams(window.location.search).get('return_to') || '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  const parsed = new URL(value, window.location.origin);
  return parsed.origin === window.location.origin && !parsed.pathname.startsWith('/sign-') ? parsed.pathname + parsed.search : '/';
}
export default function SignInForm() {
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setRegister(new URLSearchParams(window.location.search).get('mode') === 'register'); }, []);
  return <main className="auth-shell"><a href="/" className="auth-logo"><img src="/brand/comichuddle-hero-logo.jpeg" alt="ComicHuddle"/></a><section className="form-dialog auth-card"><div className="eyebrow">YOUR OWN COLLECTOR EDITION / FREE</div><h1>{register ? 'YOUR NEXT' : 'WELCOME'}<br/><span>{register ? 'CHAPTER.' : 'BACK.'}</span></h1><p>One account for your collection, marketplace and Comic Workshop. Create your collector showcase after signing in.</p><form onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/' + (register ? 'sign-up/email' : 'sign-in/email'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(form.get('email')), password: String(form.get('password')), ...(register ? { name: String(form.get('name')) } : {}) }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'Could not sign in. Check your details and try again.');
      window.location.assign(returnPath());
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Account service unavailable.'); setBusy(false); }
  }}>
    {register && <label>Display name<input name="name" required minLength={2} maxLength={60} autoComplete="name"/></label>}
    <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
    <label>Password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'}/></label>
    {register && <p>Use at least 12 characters. Email verification and password recovery are not connected in this preview.</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <button className="button red" disabled={busy}>{busy ? 'Connecting…' : register ? 'Create my free account' : 'Sign in'}</button>
  </form><button className="inline-button auth-switch" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already a collector? Sign in' : 'New here? Create a free account'}</button></section></main>;
}
