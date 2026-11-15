'use client';
// The Menu: everywhere you can go on ComicHuddle (Explore grid), then your own stuff.
// Desktop shows it as a right-side panel from the account button; phones open it from "Menu"
// in the bottom bar, so nothing on the site is more than two taps away.
import {useEffect, useState, type ComponentType} from 'react';
import {BookOpen, ChevronRight, FileText, Home, Layers, LogOut, MessageCircle, Package, ScanLine, Settings, ShieldCheck, ShoppingBag, Sparkles, Users, Wallet, Wrench, Bookmark} from 'lucide-react';
import Image from 'next/image';
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
  /** Current section, to mark "you are here". */
  current?: string;
  /** Section names: Home, Directory, Characters, Marketplace, Scan, Pressing, SafePurchase, About, Collection, Orders, Messages, Wallet, Collectors, Settings, Rules. */
  onNavigate: (section: string, tab?: string) => void;
};

type Icon = ComponentType<{size?: number; 'aria-hidden'?: boolean; strokeWidth?: number}>;
const explore: {id: string; label: string; hint: string; Icon: Icon}[] = [
  {id: 'Home', label: 'Home', hint: 'Start here', Icon: Home},
  {id: 'Directory', label: 'Directory', hint: 'Find any issue', Icon: BookOpen},
  {id: 'Characters', label: 'Characters', hint: 'Heroes & villains', Icon: Users},
  {id: 'Marketplace', label: 'Marketplace', hint: 'Buy, sell, trade', Icon: ShoppingBag},
  {id: 'Scan', label: 'Scan a comic', hint: 'Barcode or cover', Icon: ScanLine},
  {id: 'Pressing', label: 'Workshop', hint: 'Pressing pros', Icon: Wrench},
  {id: 'SafePurchase', label: 'SafePurchase', hint: 'How we check books', Icon: ShieldCheck},
  {id: 'Wallet', label: 'Wallet', hint: 'Points & credit', Icon: Wallet},
];

function useWalletSummary(signedIn: boolean) {
  const [wallet, setWallet] = useState<{points: number; creditCents: number} | 'error' | null>(null);
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

export default function AccountMenu({signedIn, name, handle, stats, unread = 0, hasStudio = false, status, onReconnect, current, onNavigate}: AccountMenuProps) {
  const wallet = useWalletSummary(signedIn);
  const exploreGrid = <section className="am-explore" aria-labelledby="am-explore-title">
    <h3 id="am-explore-title" className="am-heading">Explore ComicHuddle</h3>
    <div className="am-tiles">{explore.map(({id, label, hint, Icon}) => <button key={id} type="button" className={'am-tile' + (current === id ? ' here' : '')} aria-current={current === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
      <span className="am-tile-icon"><Icon size={22} aria-hidden={true} strokeWidth={2.1} /></span><strong>{label}</strong><small>{current === id ? 'You are here' : hint}</small>
    </button>)}</div>
  </section>;
  const help = <nav className="am-menu" aria-label="Help">
    <MenuRow Icon={Sparkles} label="About Huddles" onClick={() => onNavigate('About')} lead={<Image src="/mascot/huddles-head.webp" width={24} height={24} alt="" unoptimized />} />
    <MenuRow Icon={FileText} label="Collector rules" onClick={() => onNavigate('Rules')} />
  </nav>;

  if (!signedIn) return <div className="am am-guest">
    <div className="am-guest-hero">
      <HuddlesArt pose="sign-in" size="md" className="am-guest-art" />
      <div><p className="ds-eyebrow">Come on in</p><h2>Join free.</h2><p>Your collection, your showcase, your people.</p></div>
    </div>
    <div className="am-guest-actions">
      <a className="ds-btn ds-btn-primary" href="/sign-in?mode=register">Join free</a>
      <a className="ds-btn ds-btn-secondary" href="/sign-in">Sign in</a>
    </div>
    {exploreGrid}
    {help}
  </div>;

  return <div className="am">
    <div className="am-who">
      <span className="am-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <div>
        <h2>{name}</h2>
        {handle && <p className="am-handle">@{handle}</p>}
        <button type="button" className="ds-link" onClick={() => onNavigate('Collectors')}>View my showcase</button>
      </div>
    </div>
    {status && <p className="am-status" role="status">{status}{onReconnect && <button type="button" className="ds-link" onClick={onReconnect}>Reconnect</button>}</p>}
    {stats && <div className="am-stats">
      <button type="button" onClick={() => onNavigate('Collection', 'collection')}><strong>{stats.comics}</strong><span>Comics</span></button>
      <button type="button" onClick={() => onNavigate('Collection', 'wants')}><strong>{stats.wants}</strong><span>Wants</span></button>
      <button type="button" onClick={() => onNavigate('Collection', 'trade')}><strong>{stats.forTrade}</strong><span>For trade</span></button>
    </div>}
    <button type="button" className="am-wallet" onClick={() => onNavigate('Wallet')}>
      <Wallet size={22} aria-hidden="true" />
      <span><strong>Wallet</strong><small>{wallet === null ? 'Loading…' : wallet === 'error' ? 'Couldn’t load your wallet. Open it to retry.' : `${wallet.points.toLocaleString('en-US')} points · ${usd(wallet.creditCents)} store credit`}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    {exploreGrid}
    <section aria-labelledby="am-yours-title">
      <h3 id="am-yours-title" className="am-heading">Your stuff</h3>
      <nav className="am-menu" aria-label="Your account">
        <MenuRow Icon={Layers} label="My collection" onClick={() => onNavigate('Collection', 'collection')} />
        <MenuRow Icon={Bookmark} label="Wants" onClick={() => onNavigate('Collection', 'wants')} />
        <MenuRow Icon={Package} label="Orders" onClick={() => onNavigate('Orders')} />
        <MenuRow Icon={MessageCircle} label="Messages" badge={unread} onClick={() => onNavigate('Messages')} />
        <MenuRow Icon={Sparkles} label="Profile & showcase" onClick={() => onNavigate('Collectors')} />
        <MenuRow Icon={Wrench} label={hasStudio ? 'My workshop studio' : 'Workshop requests'} onClick={() => onNavigate('Pressing', hasStudio ? 'provider' : 'requests')} />
        <MenuRow Icon={Settings} label="Settings" onClick={() => onNavigate('Settings')} />
      </nav>
    </section>
    {help}
    <a className="am-row am-signout" href="/signout-with-chatgpt?return_to=%2Fsign-out" target="_top"><LogOut size={20} aria-hidden="true" /><span>Sign out</span></a>
  </div>;
}

function MenuRow({Icon, label, badge = 0, onClick, lead}: {Icon: Icon; label: string; badge?: number; onClick: () => void; lead?: React.ReactNode}) {
  return <button type="button" className="am-row" onClick={onClick}>
    {lead ? <span className="am-row-lead">{lead}</span> : <Icon size={20} aria-hidden={true} />}<span>{label}</span>
    {badge > 0 && <em className="am-badge" aria-label={badge + ' conversations'}>{badge > 99 ? '99+' : badge}</em>}
    <ChevronRight size={16} aria-hidden="true" className="am-chev" />
  </button>;
}
