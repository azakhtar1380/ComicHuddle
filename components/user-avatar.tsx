// One avatar everywhere: the member's profile picture when they have one, otherwise their initial
// on their profile color. `src` comes from CollectorProfile.avatarUrl (or any API field named avatarUrl).
import type {CSSProperties} from 'react';

export function avatarSrc(avatarId?: string | null) {
  return avatarId && /^[a-f0-9-]{36}$/.test(avatarId) ? '/api/avatar?id=' + avatarId : null;
}

export default function UserAvatar({name, src, color, size = 40, className = ''}: {name: string; src?: string | null; color?: string; size?: number; className?: string}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const style: CSSProperties = {width: size, height: size, fontSize: Math.round(size * 0.45), background: src ? undefined : color || 'var(--yellow)'};
  return <span className={'user-avatar ' + className} style={style} aria-hidden="true">
    {src ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" /> : initial}
  </span>;
}
