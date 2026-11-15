// The verified-business tick. Blue rosette with a white check, so it never reads as the admin's red shield.
// Render it right after a business name wherever `verified` is true (profile, listing seller, message peer).
//   <VerifiedBadge/>                      icon only, accessible name "Verified business"
//   <VerifiedBadge label/>                icon + "Verified business" text
//   <VerifiedBadge link/>                 links to /verified (don't use inside another link or button)
// No client JS: safe in server and client components.
import type {CSSProperties} from 'react';

const BLUE = '#1d5fc4';
const style = (size: number): CSSProperties => ({display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle', lineHeight: 1, color: BLUE, fontWeight: 700, fontSize: Math.max(12, Math.round(size * 0.8)), whiteSpace: 'nowrap', textDecoration: 'none'});

export function VerifiedMark({size = 16}: {size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{flex: 'none'}}>
    <path fill={BLUE} d="M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z"/>
    <path fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M7.6 12.3l3 3 5.8-6.3"/>
  </svg>;
}

export function VerifiedBadge({size = 16, label = false, link = false, className = ''}: {size?: number; label?: boolean; link?: boolean; className?: string}) {
  const content = <><VerifiedMark size={size}/>{label && <span>Verified business</span>}</>;
  const common = {className: 'verified-badge ' + className, style: style(size), title: 'Verified business'};
  if (link) return <a {...common} href="/verified" aria-label={label ? undefined : 'Verified business'}>{content}</a>;
  return label ? <span {...common}>{content}</span> : <span {...common} role="img" aria-label="Verified business">{content}</span>;
}

export default VerifiedBadge;
