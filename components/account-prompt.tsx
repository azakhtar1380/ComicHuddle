'use client';
// Shown only when a guest tries something that needs an account (buying, paying, saving, messaging,
// the wallet). Browsing never triggers it. Both buttons come back to the page the guest was on.
import {useEffect, useRef} from 'react';
import {X} from 'lucide-react';
import {HuddlesArt} from './huddles-guide';

export const DEFAULT_ACCOUNT_REASON = 'You need a free account to save comics, buy, sell and message collectors.';

export function accountLinks() {
  const here = typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search;
  const back = here.startsWith('/sign-') ? '/' : here;
  return {signIn: '/sign-in?' + new URLSearchParams({return_to: back}), join: '/sign-in?' + new URLSearchParams({mode: 'register', return_to: back})};
}

export default function AccountPrompt({reason = DEFAULT_ACCOUNT_REASON, onClose}: {reason?: string; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); }, []);
  const links = accountLinks();
  return <dialog ref={dialog} className="acct-prompt" aria-labelledby="acct-prompt-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="acct-prompt-body">
      <button type="button" className="acct-prompt-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
      <HuddlesArt pose="sign-in" size="sm" className="acct-prompt-art" />
      <h2 id="acct-prompt-title">Sign in to keep going.</h2>
      <p>{reason}</p>
      <div className="acct-prompt-actions">
        <a className="ds-btn ds-btn-primary" href={links.signIn}>Sign in</a>
        <a className="ds-btn ds-btn-secondary" href={links.join}>Create a free account</a>
      </div>
      <button type="button" className="ds-link acct-prompt-later" onClick={onClose}>Keep browsing</button>
    </div>
  </dialog>;
}
