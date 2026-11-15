'use client';
// The phone bottom bar: Home · Search · Scan · Workshop · Market · More.
// The current tab rises into a round bubble that pushes a bump up out of the bar. "More" opens the
// Menu (every page plus your account). The bar tucks away while you scroll down and hides behind dialogs.
import {useEffect, useRef, useState, type ComponentType} from 'react';
import {Home, LayoutGrid, ScanLine, Search, ShoppingBag, Wrench, X} from 'lucide-react';
import AccountMenu from '../components/account-menu';
import './mobile-dock.css';

type Props = {
  tab: string;
  scanOpen: boolean;
  onNavigate: (section: string, tab?: string) => void;
  onScan: () => void;
  /** When the page has its own account panel (the main app), "Me" opens that. */
  onMe?: () => void;
  meOpen?: boolean;
  unread?: number;
};
type Item = {id: string; label: string; Icon: ComponentType<{size?: number; strokeWidth?: number}>; match: string[]};
const homeItem: Item = {id: 'Home', label: 'Home', Icon: Home, match: ['Home']};
const searchItem: Item = {id: 'Directory', label: 'Search', Icon: Search, match: ['Directory']};
const marketItem: Item = {id: 'Marketplace', label: 'Market', Icon: ShoppingBag, match: ['Marketplace']};
const workshopItem: Item = {id: 'Pressing', label: 'Workshop', Icon: Wrench, match: ['Pressing']};
const meSections = ['Collection', 'Collectors', 'My Profile', 'Messages', 'Orders', 'Wallet', 'Settings', 'Rules', 'Account', 'Characters', 'SafePurchase', 'About'];

export default function MobileDock({tab, scanOpen, onNavigate, onScan, onMe, meOpen = false, unread = 0}: Props) {
  const [hidden, setHidden] = useState(false), [sheet, setSheet] = useState(false), [pop, setPop] = useState('');
  const [session, setSession] = useState({signedIn: false, name: 'Collector'});
  const lastY = useRef(0), dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, delta = y - lastY.current;
      if (Math.abs(delta) < 8) return;
      setHidden(delta > 0 && y > 120);
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (onMe || !sheet) return;
    const abort = new AbortController();
    fetch('/api/account-summary', {credentials: 'same-origin', cache: 'no-store', signal: abort.signal})
      .then(r => r.ok ? r.json() : null)
      .then(v => { if (v && typeof v.signedIn === 'boolean') setSession({signedIn: v.signedIn, name: typeof v.name === 'string' ? v.name : 'Collector'}); })
      .catch(() => undefined);
    return () => abort.abort();
  }, [onMe, sheet]);

  useEffect(() => {
    const node = dialog.current; if (!node) return;
    if (sheet && !node.open) node.showModal();
    if (!sheet && node.open) node.close();
  }, [sheet]);

  const tap = (id: string, action: () => void) => { setPop(id); window.setTimeout(() => setPop(''), 260); action(); };
  const meActive = meOpen || sheet || meSections.includes(tab);
  const anyOverlay = scanOpen || meOpen || sheet;
  const tabButton = (item: Item) => {
    const active = !anyOverlay && item.match.includes(tab);
    return <button type="button" key={item.id} className={'dock3-tab' + (active ? ' active' : '') + (pop === item.id ? ' pop' : '')} aria-current={active ? 'page' : undefined} onClick={() => tap(item.id, () => onNavigate(item.id))}>
      <span className="dock3-icon"><item.Icon size={22} strokeWidth={2.2} /></span><span className="dock3-label">{item.label}</span>
    </button>;
  };

  return <>
    <nav className={'dock3' + (hidden && !sheet ? ' tucked' : '')} aria-label="Main">
      {tabButton(homeItem)}
      {tabButton(searchItem)}
      <button type="button" className={'dock3-tab dock3-scan' + (scanOpen ? ' active' : '') + (pop === 'scan' ? ' pop' : '')} aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={() => tap('scan', onScan)}>
        <span className="dock3-icon"><ScanLine size={22} strokeWidth={2.3} /></span><span className="dock3-label">Scan</span>
      </button>
      {tabButton(workshopItem)}
      {tabButton(marketItem)}
      <button ref={opener} type="button" className={'dock3-tab' + (meActive && !scanOpen ? ' active' : '') + (pop === 'me' ? ' pop' : '')} aria-label={'More: every page and your account' + (unread > 0 ? ', ' + unread + ' unread conversations' : '')} aria-haspopup="dialog" aria-expanded={meOpen || sheet} aria-current={meSections.includes(tab) ? 'page' : undefined} onClick={() => tap('me', () => onMe ? onMe() : setSheet(true))}>
        <span className="dock3-icon"><LayoutGrid size={22} strokeWidth={2.2} />{unread > 0 && <i className="dock3-dot" aria-hidden="true" />}</span><span className="dock3-label">More</span>
      </button>
    </nav>
    {!onMe && <dialog ref={dialog} className="dock3-sheet" aria-label="More" onClose={() => { setSheet(false); opener.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) setSheet(false); }}>
      <div className="dock3-sheet-body">
        <span className="dock3-grip" aria-hidden="true" />
        <button type="button" className="dock3-close" aria-label="Close" onClick={() => setSheet(false)}><X size={22} /></button>
        <AccountMenu signedIn={session.signedIn} name={session.name} current={tab} onNavigate={(section, sub) => { setSheet(false); onNavigate(section, sub); }} />
      </div>
    </dialog>}
  </>;
}
