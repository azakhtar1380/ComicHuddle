'use client';
// "More": the navigation hub. Same structure for guests and members — only the account row at the
// top changes. Personal tools live in the account panel (components/account-panel.tsx), not here.
// On phones, links that are already in the bottom bar are hidden.
import type {ComponentType, ReactNode} from 'react';
import {BookOpen, ChevronRight, FileText, Info, LifeBuoy, MessageCircle, Package, ScanLine, ShieldCheck, ShoppingBag, Store, Users, Wallet, Wrench} from 'lucide-react';
import Image from 'next/image';
import UserAvatar from './user-avatar';
import {operator} from '../lib/operator';

type Icon = ComponentType<{size?: number; 'aria-hidden'?: boolean; strokeWidth?: number}>;
export type MoreMenuProps = {
  signedIn: boolean;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  unread?: number;
  hasStudio?: boolean;
  current?: string;
  /** Section names understood by the hub: Directory, Characters, Marketplace, Scan, Pressing (+ requests|provider|register), Messages, Collection, Wallet, Orders, SafePurchase, About, Rules. */
  onNavigate: (section: string, sub?: string) => void;
  onOpenAccount: () => void;
};

const dockIds = new Set(['Directory', 'Marketplace', 'Scan']);

export default function MoreMenu({signedIn, name, handle, avatarUrl, unread = 0, hasStudio = false, current, onNavigate, onOpenAccount}: MoreMenuProps) {
  const row = (id: string, label: string, Icon: Icon, opts: {sub?: string; hint?: string; badge?: number; lead?: ReactNode} = {}) =>
    <button key={id + (opts.sub || '')} type="button" className={'mm-row' + (dockIds.has(id) ? ' mm-in-dock' : '') + (current === id && !opts.sub ? ' is-here' : '')} aria-current={current === id && !opts.sub ? 'page' : undefined} onClick={() => onNavigate(id, opts.sub)}>
      <span className="mm-icon">{opts.lead || <Icon size={20} aria-hidden strokeWidth={2.1} />}</span>
      <span className="mm-text"><strong>{label}</strong>{opts.hint && <small>{current === id && !opts.sub ? 'You are here' : opts.hint}</small>}</span>
      {opts.badge ? <em className="mm-badge" aria-label={opts.badge + ' unread'}>{opts.badge > 99 ? '99+' : opts.badge}</em> : null}
      <ChevronRight size={16} aria-hidden className="mm-chev" />
    </button>;

  return <div className="mm">
    {signedIn
      ? <button type="button" className="mm-account" onClick={onOpenAccount}>
          <UserAvatar name={name} src={avatarUrl} size={48} />
          <span className="mm-text"><strong>{name}</strong><small>{handle ? '@' + handle + ' · ' : ''}Your account</small></span>
          <ChevronRight size={18} aria-hidden className="mm-chev" />
        </button>
      : <div className="mm-account mm-guest">
          <Image src="/mascot/huddles-head.webp" width={48} height={48} alt="" unoptimized />
          <span className="mm-text"><strong>Browse freely.</strong><small>Join to collect, sell and message.</small></span>
          <span className="mm-guest-actions"><a className="ds-btn ds-btn-sm ds-btn-secondary" href="/sign-in">Sign in</a><a className="ds-btn ds-btn-sm ds-btn-primary" href="/sign-in?mode=register">Join free</a></span>
        </div>}

    <section className="mm-group" aria-labelledby="mm-workshop">
      <h3 id="mm-workshop" className="mm-heading">Comic Workshop</h3>
      <button type="button" className={'mm-feature' + (current === 'Pressing' ? ' is-here' : '')} onClick={() => onNavigate('Pressing')}>
        <span className="mm-feature-icon"><Wrench size={22} aria-hidden /></span>
        <span className="mm-text"><strong>Find a comic pro</strong><small>Pressing, cleaning, restoration and CGC prep near you.</small></span>
        <ChevronRight size={18} aria-hidden className="mm-chev" />
      </button>
      <div className="mm-list">
        {row('Pressing', 'Your workshop requests', Package, {sub: 'requests'})}
        {row('Pressing', hasStudio ? 'Your studio' : 'List your studio', Store, {sub: hasStudio ? 'provider' : 'register'})}
      </div>
    </section>

    <section className="mm-group" aria-labelledby="mm-browse">
      <h3 id="mm-browse" className="mm-heading">Browse</h3>
      <div className="mm-list">
        {row('Directory', 'Comic directory', BookOpen, {hint: 'Find any issue'})}
        {row('Characters', 'Characters', Users, {hint: 'Heroes and villains'})}
        {row('Marketplace', 'Marketplace', ShoppingBag, {hint: 'Buy, sell, trade'})}
        {row('Scan', 'Scan a comic', ScanLine, {hint: 'Barcode or cover'})}
      </div>
    </section>

    <section className="mm-group" aria-labelledby="mm-yours">
      <h3 id="mm-yours" className="mm-heading">Yours</h3>
      <div className="mm-list">
        {row('Messages', 'Messages', MessageCircle, {badge: unread})}
        {row('Wallet', 'Wallet & rewards', Wallet)}
        {row('Orders', 'Orders', Package)}
      </div>
    </section>

    <section className="mm-group" aria-labelledby="mm-help">
      <h3 id="mm-help" className="mm-heading">Help</h3>
      <div className="mm-list">
        {row('SafePurchase', 'SafePurchase', ShieldCheck)}
        {row('About', 'Meet Huddles', Users, {lead: <Image src="/mascot/huddles-head.webp" width={28} height={28} alt="" unoptimized />})}
        {row('Rules', 'Collector rules', FileText)}
        <a className="mm-row" href="/about"><span className="mm-icon"><Info size={20} aria-hidden /></span><span className="mm-text"><strong>About us</strong><small>What ComicHuddle is</small></span><ChevronRight size={16} aria-hidden className="mm-chev" /></a>
        <a className="mm-row" href="/contact"><span className="mm-icon"><LifeBuoy size={20} aria-hidden /></span><span className="mm-text"><strong>Contact us</strong><small>{operator.supportEmail}</small></span><ChevronRight size={16} aria-hidden className="mm-chev" /></a>
      </div>
    </section>
  </div>;
}
