// The one page header every page uses: eyebrow, two-line headline (second line red), one plain
// sentence, actions, and Huddles on the right.
import type {ReactNode} from 'react';
import HuddlesGuide, {type HuddlesPose} from './huddles-guide';

export default function PageHeader({eyebrow, title, accent, lede, actions, pose, caption, line, headingLevel = 1, id}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  lede?: ReactNode;
  actions?: ReactNode;
  pose?: HuddlesPose;
  caption?: string;
  line?: string;
  headingLevel?: 1 | 2;
  id?: string;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return <header className={'ds-page-header' + (pose ? '' : ' no-art')}>
    <div className="ds-page-copy">
      {eyebrow && <p className="ds-eyebrow">{eyebrow}</p>}
      <Heading className="ds-title" id={id}>{title}{accent && <><br /><span>{accent}</span></>}</Heading>
      {lede && <p className="ds-lede">{lede}</p>}
      {actions && <div className="ds-actions">{actions}</div>}
    </div>
    {pose && <HuddlesGuide pose={pose} caption={caption} line={line} size="lg" className="ds-page-art" />}
  </header>;
}
