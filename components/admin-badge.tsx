// Admin badge: a red shield with a tick, distinct from the business "verified" tick (components/verified-badge.tsx).
// Shows "Admin" on hover (title) and to screen readers; the site owner also gets a visible "Founder" label.
// Pass only the booleans from lib/admin-audit.ts staffBadgeForUser / staffBadgesForProfiles (or /api/admin/me
// for the signed-in account). Never pass emails to the client.
import './admin-badge.css';

export default function AdminBadge({admin = true, founder = false, size = 16, showLabel = false}: {admin?: boolean; founder?: boolean; size?: number; showLabel?: boolean}) {
  if (!admin && !founder) return null;
  const label = founder ? 'Founder and ComicHuddle admin' : 'ComicHuddle admin';
  return <span className="ch-admin-badge" title={founder ? 'Founder · Admin' : 'Admin'} aria-label={label} role="img">
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.2 4 5.2v6.1c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5.2l-8-3Z" fill="var(--red,#c83e30)" stroke="var(--ink,#20201f)" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="m8.2 12.1 2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    {founder ? <span className="ch-admin-badge-label">Founder</span> : showLabel ? <span className="ch-admin-badge-label">Admin</span> : null}
  </span>;
}
