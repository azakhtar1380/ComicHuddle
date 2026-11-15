// Huddles, the hero from the ComicHuddle logo. He's drawn *into* the page: a transparent cut-out
// standing on a soft halftone spotlight with a flat ground shadow — never boxed, never with text on him.
// Words go in the "Huddles' tip" line (<HuddlesTip/>) next to the page text.
import Image from 'next/image';
import Link from 'next/link';

export const huddlesPoses = {
  home: {file: '01-home', alt: 'Huddles flying forward holding out an open comic', ground: false},
  directory: {file: '02-directory', alt: 'Huddles searching a box of comics with a magnifying glass', ground: true},
  scanner: {file: '03-scanner', alt: 'Huddles scanning a comic with a phone', ground: true},
  'add-comic': {file: '04-add-comic', alt: 'Huddles carefully bagging a comic', ground: true},
  marketplace: {file: '05-marketplace', alt: 'Huddles lifting a full box of comics overhead', ground: true},
  community: {file: '06-community', alt: 'Huddles in a huddle with two collectors', ground: true},
  empty: {file: '07-empty', alt: 'Huddles shrugging on an empty comic box', ground: true},
  'sign-out': {file: '08-sign-out', alt: 'Huddles flying away and waving goodbye', ground: false},
  'sign-in': {file: '09-sign-in', alt: 'Huddles holding a door open', ground: true},
  safepurchase: {file: '10-safepurchase', alt: 'Huddles guarding a cased comic with a shield', ground: true},
  wallet: {file: '11-wallet', alt: 'Huddles catching gold reward stars', ground: true},
  workshop: {file: '12-workshop', alt: 'Huddles in an apron pressing a comic', ground: true},
  messages: {file: '13-messages', alt: 'Huddles texting on a phone', ground: false},
  profile: {file: '14-profile', alt: 'Huddles giving a thumbs up by a comic shelf', ground: true},
  trade: {file: '15-trade', alt: 'Huddles trading comics with a collector', ground: true},
  auction: {file: '16-auction', alt: 'Huddles swinging an auction gavel', ground: true},
  grading: {file: '17-grading', alt: 'Huddles inspecting a comic with a magnifier', ground: true},
  error: {file: '18-error', alt: 'Huddles crashed upside down into a pile of comics', ground: true},
  loading: {file: '19-loading', alt: 'Huddles running with a stack of comics', ground: true},
  listing: {file: '20-listing', alt: 'Huddles photographing a comic', ground: true},
  notifications: {file: '22-notifications', alt: 'Huddles with a megaphone and ringing bell', ground: false},
  characters: {file: '25-characters', alt: 'Huddles pointing at a wall of hero and villain silhouettes', ground: true},
  'hero-vs-villain': {file: '26-hero-vs-villain', alt: 'Huddles arm-wrestling a shadowy villain', ground: true},
  'peek-top': {file: '27-peek-top', alt: 'Huddles peeking over the edge', ground: false},
  'peek-side': {file: '28-peek-side', alt: 'Huddles peeking around the edge', ground: false},
  'thank-you': {file: '29-thank-you', alt: 'Huddles handing over a wrapped comic', ground: true},
  portrait: {file: '30-portrait', alt: 'Huddles standing tall, fists on his hips', ground: true},
  origin: {file: '31-origin', alt: 'Huddles leaping out of an open comic book', ground: true},
  oath: {file: '32-oath', alt: 'Huddles with a hand on his chest emblem, taking an oath', ground: true},
} as const;

export type HuddlesPose = keyof typeof huddlesPoses;
export type HuddlesSize = 'xl' | 'lg' | 'md' | 'sm';
const pixels: Record<HuddlesSize, number> = {xl: 420, lg: 320, md: 200, sm: 72};

export function huddlesSrc(pose: HuddlesPose, format: 'webp' | 'png' = 'webp') {
  return `/mascot/huddles-${huddlesPoses[pose].file}.${format}`;
}

/** Just the artwork. Decorative by default (alt="" + aria-hidden), since the page text says what matters. */
export function HuddlesArt({pose, size = 'md', decorative = true, className = ''}: {pose: HuddlesPose; size?: HuddlesSize; decorative?: boolean; className?: string}) {
  const px = pixels[size];
  return <Image className={'huddles-art ' + className} src={huddlesSrc(pose)} width={px} height={px} alt={decorative ? '' : huddlesPoses[pose].alt} aria-hidden={decorative || undefined} sizes={px + 'px'} unoptimized />;
}

/** The "Huddles' tip" line: head icon (→ About Huddles) + yellow pill tag + one short sentence. */
export function HuddlesTip({children, className = ''}: {children: React.ReactNode; className?: string}) {
  return <p className={'huddles-tip ' + className}>
    <Link href="/about-huddles" className="huddles-tip-head" aria-label="Who's Huddles? Meet our guide"><Image src="/mascot/huddles-head.webp" width={28} height={28} alt="" unoptimized /></Link>
    <span className="huddles-tip-tag">Huddles&apos; tip</span>
    <span className="huddles-tip-text">{children}</span>
  </p>;
}

/**
 * Huddles placed in the layout. `caption` is accepted for older call sites but no longer drawn on him
 * (where-you-are belongs in the page eyebrow). `line` becomes a tip line under him, never over him.
 */
export default function HuddlesGuide({pose, line, size = 'lg', tone = 'yellow', className = ''}: {
  pose: HuddlesPose;
  caption?: string;
  line?: string;
  size?: HuddlesSize;
  tone?: 'yellow' | 'cream' | 'blue' | 'red';
  className?: string;
}) {
  if (size === 'sm') return <HuddlesArt pose={pose} size="sm" className={className} />;
  return <div className={`huddles huddles-${size} huddles-tone-${tone} ${className}`}>
    <div className="huddles-stage" aria-hidden="true">
      <span className="huddles-spot" />
      {huddlesPoses[pose].ground && <span className="huddles-ground" />}
      <HuddlesArt pose={pose} size={size} className="huddles-figure" />
    </div>
    {line && <HuddlesTip className="huddles-under-tip">{line}</HuddlesTip>}
  </div>;
}

/** Huddles hiding behind a big card: over its top edge or around its right edge. Purely decorative. */
export function HuddlesPeek({edge = 'top', className = ''}: {edge?: 'top' | 'right'; className?: string}) {
  return <span className={`huddles-peek huddles-peek-${edge} ${className}`} aria-hidden="true">
    <Image src={huddlesSrc(edge === 'top' ? 'peek-top' : 'peek-side')} width={edge === 'top' ? 180 : 96} height={96} alt="" unoptimized />
  </span>;
}
