// The one page header every page uses: a rounded block with the eyebrow (where you are), a two-line
// headline (second line red), one plain sentence, the Huddles' tip line, then the actions. Huddles
// stands on the block's bottom edge on the right and bleeds into the next section.
import type {ReactNode} from 'react';
import HuddlesGuide, {HuddlesTip, type HuddlesPose} from './huddles-guide';

export default function PageHeader({eyebrow, title, accent, lede, actions, pose, caption, line, headingLevel = 1, id}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  lede?: ReactNode;
  actions?: ReactNode;
  pose?: HuddlesPose;
  /** Older call sites: shown as the eyebrow when no eyebrow is given. */
  caption?: string;
  /** Huddles' tip (one short sentence). */
  line?: string;
  headingLevel?: 1 | 2;
  id?: string;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const label = eyebrow || caption;
  return <header className={'ds-page-header' + (pose ? ' has-art' : ' no-art')}>
    <div className="ds-page-copy">
      {label && <p className="ds-eyebrow">{label}</p>}
      <Heading className="ds-title" id={id}>{title}{accent && <><br /><span>{accent}</span></>}</Heading>
      {lede && <p className="ds-lede">{lede}</p>}
      {line && <HuddlesTip>{line}</HuddlesTip>}
      {actions && <div className="ds-actions">{actions}</div>}
    </div>
    {pose && <HuddlesGuide pose={pose} size="lg" className="ds-page-art" />}
  </header>;
}
