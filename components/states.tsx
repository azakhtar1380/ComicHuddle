// Shared empty, loading and error states, each with Huddles, one line and (optionally) one button.
import type {ReactNode} from 'react';
import {HuddlesArt} from './huddles-guide';

type Action = {label: string; onClick?: () => void; href?: string};

function ActionButton({action, primary = true}: {action?: Action; primary?: boolean}) {
  if (!action) return null;
  const className = 'ds-btn ' + (primary ? 'ds-btn-primary' : 'ds-btn-secondary');
  return action.href ? <a className={className} href={action.href}>{action.label}</a> : <button type="button" className={className} onClick={action.onClick}>{action.label}</button>;
}

export function EmptyState({title, message, action, secondary, compact = false, children}: {title: string; message?: ReactNode; action?: Action; secondary?: Action; compact?: boolean; children?: ReactNode}) {
  return <div className={'ds-state ds-state-empty' + (compact ? ' compact' : '')}>
    <HuddlesArt pose="empty" size={compact ? 'sm' : 'md'} decorative />
    <div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {children}
      {(action || secondary) && <div className="ds-actions"><ActionButton action={action} /><ActionButton action={secondary} primary={false} /></div>}
    </div>
  </div>;
}

export function LoadingState({message = 'Loading…', compact = false}: {message?: string; compact?: boolean}) {
  return <div className={'ds-state ds-state-loading' + (compact ? ' compact' : '')} role="status" aria-live="polite">
    <HuddlesArt pose="loading" size={compact ? 'sm' : 'md'} decorative className="ds-run" />
    <p>{message}</p>
  </div>;
}

export function ErrorState({message = 'Something went wrong. Try again.', action, compact = false}: {message?: string; action?: Action; compact?: boolean}) {
  return <div className={'ds-state ds-state-error' + (compact ? ' compact' : '')} role="alert">
    <HuddlesArt pose="error" size={compact ? 'sm' : 'md'} decorative />
    <div>
      <h3>KA-BLAM!</h3>
      <p>{message}</p>
      {action && <div className="ds-actions"><ActionButton action={action} /></div>}
    </div>
  </div>;
}

/** One collapsible "How this works" block for long explanations. */
export function HowItWorks({title = 'How this works', children, open = false}: {title?: string; children: ReactNode; open?: boolean}) {
  return <details className="ds-how" open={open}><summary>{title}</summary><div className="ds-how-body">{children}</div></details>;
}
