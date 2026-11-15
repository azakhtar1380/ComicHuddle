'use client';
// The quick account panel: who you are, three stat tiles, a wallet tile and a short menu.
// Desktop shows it as a right-side panel, phones as a bottom sheet ("Me" in the bottom bar).
import {useEffect, useState, type ComponentType} from 'react';
import {Bookmark, BookOpen, ChevronRight, FileText, Layers, LogOut, MessageCircle, Package, Settings, ShieldCheck, Sparkles, User, Users, Wallet, Wrench} from 'lucide-react';
import {HuddlesArt} from './huddles-guide';

export type AccountMenuProps = {
  signedIn: boolean;
  name: string;
  handle?: string | null;
  stats?: {comics: number; wants: number; forTrade: number} | null;
  unread?: number;
  hasStudio?: boolean;
  status?: string | null;
  onReconnect?: (() => void) | null;
  /** Section names understood by the app: Collection, Orders, Messages, Wallet, Collectors, Settings, Rules, Characters, Pressing … */
  onNavigate: (section: string, tab?: string) => void;
};

type Wallet = {points: number; creditCents: number} | null;

function useWalletSummary(signedIn: boolean) {
  const [wallet, setWallet] = useState<Wallet | 'error' | null>(null);
  useEffect(() => {
    if (!signedIn) return;
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
  }, [signedIn]);
  return wallet;
}

const usd = (cents: number) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);

export default function AccountMenu({signedIn, name, handle, stats, unread = 0, hasStudio = false, status, onReconnect, onNavigate}: AccountMenuProps) {
  const wallet = useWalletSummary(signedIn);
  if (!signedIn) return <div className="am am-guest">
    <HuddlesArt pose="sign-in" size="md" decorative className="am-guest-art" />
    <p className="ds-eyebrow">Come on in</p>
    <h2>Join free.</h2>
    <p>Your collection, your showcase, your people. It takes a minute.</p>
    <div className="am-guest-actions">
      <a className="ds-btn ds-btn-primary" href="/sign-in?mode=register">Join free</a>
      <a className="ds-btn ds-btn-secondary" href="/sign-in">Sign in</a>
    </div>
    <nav className="am-menu" aria-label="More">
      <MenuRow Icon={Users} label="Characters" onClick={() => onNavigate('Characters')} />
      <MenuRow Icon={Wrench} label="Comic Workshop" onClick={() => onNavigate('Pressing')} />
      <MenuRow Icon={ShieldCheck} label="SafePurchase" onClick={() => onNavigate('SafePurchase')} />
      <MenuRow Icon={FileText} label="Collector rules" onClick={() => onNavigate('Rules')} />
    </nav>
  </div>;

  return <div className="am">
    <div className="am-who">
      <span className="am-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <div>
        <h2>{name}</h2>
        {handle && <p className="am-handle">@{handle}</p>}
        <button type="button" className="ds-link" onClick={() => onNavigate('Collectors')}>View my showcase</button>
      </div>
      <HuddlesArt pose="profile" size="sm" decorative className="am-corner" />
    </div>
    {status && <p className="am-status" role="status">{status}{onReconnect && <button type="button" className="ds-link" onClick={onReconnect}>Reconnect</button>}</p>}
    {stats && <div className="am-stats">
      <button type="button" onClick={() => onNavigate('Collection', 'collection')}><strong>{stats.comics}</strong><span>Comics</span></button>
      <button type="button" onClick={() => onNavigate('Collection', 'wants')}><strong>{stats.wants}</strong><span>Wants</span></button>
      <button type="button" onClick={() => onNavigate('Collection', 'trade')}><strong>{stats.forTrade}</strong><span>For trade</span></button>
    </div>}
    <button type="button" className="am-wallet" onClick={() => onNavigate('Wallet')}>
      <Wallet size={22} aria-hidden="true" />
      <span>
        <strong>Wallet</strong>
        <small>{wallet === null ? 'Loading…' : wallet === 'error' ? 'Couldn’t load your wallet. Open it to retry.' : `${wallet.points.toLocaleString('en-US')} points · ${usd(wallet.creditCents)} store credit`}</small>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    <nav className="am-menu" aria-label="Account">
      <MenuRow Icon={Layers} label="My collection" onClick={() => onNavigate('Collection', 'collection')} />
      <MenuRow Icon={Bookmark} label="Wants" onClick={() => onNavigate('Collection', 'wants')} />
      <MenuRow Icon={Package} label="Orders" onClick={() => onNavigate('Orders')} />
      <MenuRow Icon={MessageCircle} label="Messages" badge={unread} onClick={() => onNavigate('Messages')} />
      <MenuRow Icon={Wallet} label="Wallet" onClick={() => onNavigate('Wallet')} />
      <MenuRow Icon={Sparkles} label="Profile & showcase" onClick={() => onNavigate('Collectors')} />
      <MenuRow Icon={Wrench} label={hasStudio ? 'My workshop studio' : 'Workshop requests'} onClick={() => onNavigate('Pressing', hasStudio ? 'provider' : 'requests')} />
      <MenuRow Icon={Users} label="Characters" onClick={() => onNavigate('Characters')} />
      <MenuRow Icon={Settings} label="Settings" onClick={() => onNavigate('Settings')} />
      <MenuRow Icon={BookOpen} label="Collector rules" onClick={() => onNavigate('Rules')} />
      <a className="am-row am-signout" href="/signout-with-chatgpt?return_to=%2Fsign-out" target="_top"><LogOut size={20} aria-hidden="true" /><span>Sign out</span></a>
    </nav>
  </div>;
}

function MenuRow({Icon, label, badge = 0, onClick}: {Icon: ComponentType<{size?: number; 'aria-hidden'?: boolean}>; label: string; badge?: number; onClick: () => void}) {
  return <button type="button" className="am-row" onClick={onClick}>
    <Icon size={20} aria-hidden={true} /><span>{label}</span>
    {badge > 0 && <em className="am-badge" aria-label={badge + ' conversations'}>{badge > 99 ? '99+' : badge}</em>}
    <ChevronRight size={16} aria-hidden="true" className="am-chev" />
  </button>;
}

export {User as AccountIcon};
