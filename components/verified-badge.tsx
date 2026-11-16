// The verified check: a blue rosette with a white check, for verified collectors (kind="person") and verified
// businesses (kind="business"). It never reads as the admin's red shield. Put it right after the name everywhere
// the name shows (profile, listing seller line, messages, offers, reviews, share card, OG image).
//   <VerifiedBadge kind="person"/>          icon only, accessible name "Verified collector"
//   <VerifiedBadge kind="business" label/>  icon + "Verified business" text (+ the blue "Shop" tag)
//   <VerifiedBadge link/>                   links to /verified (don't use inside another link or button)
// A verified business also gets a small blue "Shop" tag with a storefront icon. No client JS.
import type {CSSProperties} from 'react';

const BLUE = '#1d5fc4';
export type VerifiedKind = 'person' | 'business';
export const verifiedLabel = (kind: VerifiedKind) => kind === 'business' ? 'Verified business' : 'Verified collector';
const style = (size: number): CSSProperties => ({display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle', lineHeight: 1, color: BLUE, fontWeight: 700, fontSize: Math.max(12, Math.round(size * 0.8)), whiteSpace: 'nowrap', textDecoration: 'none'});
const shopStyle: CSSProperties = {display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4, padding: '1px 6px', borderRadius: 999, background: BLUE, color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1.4};

export function VerifiedMark({size = 16}: {size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{flex: 'none'}}>
    <path fill={BLUE} d="M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z"/>
    <path fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M7.6 12.3l3 3 5.8-6.3"/>
  </svg>;
}
function ShopTag() {
  return <span style={shopStyle} aria-hidden="true"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l2-5h14l2 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>Shop</span>;
}

export function VerifiedBadge({kind = 'business', size = 16, label = false, link = false, shopTag = true, className = ''}: {kind?: VerifiedKind; size?: number; label?: boolean; link?: boolean; shopTag?: boolean; className?: string}) {
  const name = verifiedLabel(kind);
  const content = <><VerifiedMark size={size}/>{label && <span>{name}</span>}{kind === 'business' && shopTag && <ShopTag/>}</>;
  const common = {className: 'verified-badge verified-' + kind + ' ' + className, style: style(size), title: name};
  if (link) return <a {...common} href="/verified" aria-label={label ? undefined : name}>{content}</a>;
  return label ? <span {...common}>{content}</span> : <span {...common} role="img" aria-label={name}>{content}</span>;
}

export default VerifiedBadge;
