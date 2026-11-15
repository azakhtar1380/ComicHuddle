'use client';
// The signed-in account panel: who you are (picture, name, @handle), your numbers, and every personal
// tool in one place. Navigation lives in "More" (components/more-menu.tsx).
import {useEffect, useRef, useState, type ComponentType} from 'react';
import {ArrowLeftRight, Bookmark, Camera, ChevronRight, Gavel, Layers, LogOut, MessageCircle, Receipt, Repeat, Settings, ShieldCheck, ShoppingBag, Sparkles, Tag, Wallet, Wrench} from 'lucide-react';
import UserAvatar from './user-avatar';
import AdminBadge from './admin-badge';

type Icon = ComponentType<{size?: number; 'aria-hidden'?: boolean}>;
export type AccountPanelProps = {
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  color?: string;
  location?: string | null;
  since?: number | null;
  hasProfile: boolean;
  stats?: {comics: number; wants: number; forTrade: number} | null;
  unread?: number;
  hasStudio?: boolean;
  status?: string | null;
  onReconnect?: (() => void) | null;
  onAvatarChange: (url: string | null) => void;
  /** Shows the Admin tools entry. The server re-checks admin on every admin route. */
  isAdmin?: boolean;
  isFounder?: boolean;
  /** Collection(+collection|wants|trade), Listings(+mine|sold|won), Orders(+buyer|seller), Messages, Wallet, Collectors, Pressing(+requests|provider), Settings. */
  onNavigate: (section: string, sub?: string) => void;
};

function useWalletSummary() {
  const [wallet, setWallet] = useState<{points: number; creditCents: number} | 'error' | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/wallet', {credentials: 'same-origin', cache: 'no-store', signal: abort.signal})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw Error();
        const balances = body?.rewards?.balances ?? {};
        const pick = (balances.live && (balances.live.points || balances.live.availableCreditCents)) ? balances.live : balances.sandbox || balances.live;
        setWallet({points: Number(pick?.points || 0), creditCents: Number(pick?.availableCreditCents || 0)});
      })
      .catch(() => { if (!abort.signal.aborted) setWallet('error'); });
    return () => abort.abort();
  }, []);
  return wallet;
}
const usd = (cents: number) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);

export default function AccountPanel(props: AccountPanelProps) {
  const {name, handle, avatarUrl, color, location, since, hasProfile, stats, unread = 0, hasStudio = false, status, onReconnect, onAvatarChange, onNavigate, isAdmin = false, isFounder = false} = props;
  const wallet = useWalletSummary();
  const [editing, setEditing] = useState(false);
  const row = (label: string, Icon: Icon, section: string, sub?: string, badge = 0) =>
    <button type="button" className="ap-row" onClick={() => onNavigate(section, sub)}>
      <Icon size={20} aria-hidden /><span>{label}</span>
      {badge > 0 && <em className="mm-badge" aria-label={badge + ' unread'}>{badge > 99 ? '99+' : badge}</em>}
      <ChevronRight size={16} aria-hidden className="mm-chev" />
    </button>;
  const memberSince = !since ? null : since < 3000 ? since : new Date(since > 1e12 ? since : since * 1000).getFullYear();

  return <div className="ap">
    <header className="ap-who">
      <button type="button" className="ap-photo" onClick={() => setEditing(true)} aria-label={avatarUrl ? 'Change profile picture' : 'Add a profile picture'} disabled={!hasProfile} title={hasProfile ? undefined : 'Create your profile first'}>
        <UserAvatar name={name} src={avatarUrl} color={color} size={76} />
        {hasProfile && <span className="ap-photo-badge"><Camera size={15} aria-hidden /></span>}
      </button>
      <div className="ap-id">
        <h2>{name}{isAdmin && <> <AdminBadge founder={isFounder} size={18} showLabel /></>}</h2>
        {handle ? <p>@{handle}</p> : <p>No public profile yet</p>}
        <p className="ap-meta">{[location, memberSince && memberSince > 1990 && memberSince <= new Date().getFullYear() ? 'Collector since ' + memberSince : null].filter(Boolean).join(' · ')}</p>
        <button type="button" className="ds-link" onClick={() => onNavigate('Collectors')}>{hasProfile ? 'View my profile' : 'Create my profile'}</button>
      </div>
    </header>
    {status && <p className="am-status" role="status">{status}{onReconnect && <button type="button" className="ds-link" onClick={onReconnect}>Reconnect</button>}</p>}
    {stats && <div className="ap-stats">
      <button type="button" onClick={() => onNavigate('Collection', 'collection')}><strong>{stats.comics.toLocaleString('en-US')}</strong><span>Comics</span></button>
      <button type="button" onClick={() => onNavigate('Collection', 'wants')}><strong>{stats.wants.toLocaleString('en-US')}</strong><span>Wants</span></button>
      <button type="button" onClick={() => onNavigate('Collection', 'trade')}><strong>{stats.forTrade.toLocaleString('en-US')}</strong><span>For trade</span></button>
    </div>}
    <button type="button" className="ap-wallet" onClick={() => onNavigate('Wallet')}>
      <Wallet size={22} aria-hidden />
      <span><strong>Wallet</strong><small>{wallet === null ? 'Loading…' : wallet === 'error' ? 'Open your wallet to see your balance.' : `${wallet.points.toLocaleString('en-US')} points · ${usd(wallet.creditCents)} credit`}</small></span>
      <ChevronRight size={18} aria-hidden />
    </button>

    <section className="ap-group" aria-labelledby="ap-collect"><h3 id="ap-collect" className="mm-heading">Collection</h3>
      {row('My collection', Layers, 'Collection', 'collection')}
      {row('Saved comics (wants)', Bookmark, 'Collection', 'wants')}
      {row('For trade', Repeat, 'Collection', 'trade')}
    </section>
    <section className="ap-group" aria-labelledby="ap-sell"><h3 id="ap-sell" className="mm-heading">Buying & selling</h3>
      {row('Offers & trades', ArrowLeftRight, 'Offers')}
      {row('My listings', Tag, 'Listings', 'mine')}
      {row('Purchases', ShoppingBag, 'Orders', 'buyer')}
      {row('Sales', Receipt, 'Orders', 'seller')}
      {row('Won auctions', Gavel, 'Listings', 'won')}
      {row('Wallet & transactions', Wallet, 'Wallet')}
    </section>
    <section className="ap-group" aria-labelledby="ap-more"><h3 id="ap-more" className="mm-heading">You</h3>
      {row('Messages', MessageCircle, 'Messages', undefined, unread)}
      {row('Profile & showcase', Sparkles, 'Collectors')}
      {row(hasStudio ? 'My workshop studio' : 'Workshop requests', Wrench, 'Pressing', hasStudio ? 'provider' : 'requests')}
      {row('Settings', Settings, 'Settings')}
    </section>
    {isAdmin && <section className="ap-group ap-admin" aria-labelledby="ap-admin"><h3 id="ap-admin" className="mm-heading">Admin</h3>
      {row('Admin tools', ShieldCheck, 'Admin')}
      {row('SafePurchase orders', ShieldCheck, 'Admin', 'safepurchase')}
    </section>}
    <a className="ap-row ap-signout" href="/signout-with-chatgpt?return_to=%2Fsign-out" target="_top"><LogOut size={20} aria-hidden /><span>Sign out</span></a>
    {editing && <AvatarEditor name={name} color={color} current={avatarUrl || null} onClose={() => setEditing(false)} onSaved={url => { onAvatarChange(url); setEditing(false); }} />}
  </div>;
}

const MAX_BYTES = 4 * 1024 * 1024;
export function AvatarEditor({name, color, current, onClose, onSaved}: {name: string; color?: string; current: string | null; onClose: () => void; onSaved: (url: string | null) => void}) {
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const choose = (next: File | undefined) => {
    setError('');
    if (!next) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError('Choose a JPEG, PNG or WebP photo.'); return; }
    if (next.size > MAX_BYTES) { setError('That photo is over 4 MB. Choose a smaller one.'); return; }
    setFile(next); setPreview(URL.createObjectURL(next));
  };
  const send = async (method: 'POST' | 'DELETE') => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/avatar', {method, credentials: 'same-origin', headers: method === 'POST' ? {'Content-Type': file!.type} : undefined, body: method === 'POST' ? file : undefined});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(typeof body?.error === 'string' ? body.error : 'That didn’t work. Please try again.');
      onSaved(typeof body.avatarUrl === 'string' ? body.avatarUrl + '&v=' + Date.now() : null);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'That didn’t work. Please try again.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="ap-editor" aria-labelledby="ap-editor-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="ap-editor-body">
      <h2 id="ap-editor-title">Profile picture</h2>
      <p>Shown on your profile, your listings and in messages.</p>
      <div className="ap-editor-preview">
        <UserAvatar name={name} color={color} src={preview || current} size={140} />
        {preview && <small>Preview — not saved yet</small>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => choose(event.target.files?.[0])} />
      {error && <p className="ds-error" role="alert">{error}</p>}
      <div className="ap-editor-actions">
        <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => input.current?.click()}>{current || preview ? 'Choose another photo' : 'Choose a photo'}</button>
        <button type="button" className="ds-btn ds-btn-primary" disabled={busy || !file} onClick={() => void send('POST')}>{busy ? 'Saving…' : 'Save picture'}</button>
      </div>
      <div className="ap-editor-foot">
        {current && !preview && <button type="button" className="ds-link ap-remove" disabled={busy} onClick={() => void send('DELETE')}>Remove picture</button>}
        <button type="button" className="ds-link" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      <small className="ap-editor-note">JPEG, PNG or WebP, up to 4 MB. We crop it to a square.</small>
    </div>
  </dialog>;
}
