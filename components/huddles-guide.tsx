// Huddles, the hero from the ComicHuddle logo, as a comic panel that guides people around the site.
// One component everywhere: a bordered halftone panel, an optional yellow caption box ("where you are")
// and an optional speech bubble ("what to do next"). Part of Huddles breaks out past the panel border.
import Image from 'next/image';

export const huddlesPoses = {
  home: {file: '01-home', alt: 'Huddles flying forward holding out an open comic'},
  directory: {file: '02-directory', alt: 'Huddles searching a box of comics with a magnifying glass'},
  scanner: {file: '03-scanner', alt: 'Huddles scanning a comic with a phone'},
  'add-comic': {file: '04-add-comic', alt: 'Huddles carefully bagging a comic'},
  marketplace: {file: '05-marketplace', alt: 'Huddles lifting a full box of comics overhead'},
  community: {file: '06-community', alt: 'Huddles in a huddle with two collectors'},
  empty: {file: '07-empty', alt: 'Huddles shrugging on an empty comic box'},
  'sign-out': {file: '08-sign-out', alt: 'Huddles flying away and waving goodbye'},
  'sign-in': {file: '09-sign-in', alt: 'Huddles holding a door open'},
  safepurchase: {file: '10-safepurchase', alt: 'Huddles guarding a cased comic with a shield'},
  wallet: {file: '11-wallet', alt: 'Huddles catching gold reward stars'},
  workshop: {file: '12-workshop', alt: 'Huddles in an apron pressing a comic'},
  messages: {file: '13-messages', alt: 'Huddles texting on a phone'},
  profile: {file: '14-profile', alt: 'Huddles giving a thumbs up by a comic shelf'},
  trade: {file: '15-trade', alt: 'Huddles trading comics with a collector'},
  auction: {file: '16-auction', alt: 'Huddles swinging an auction gavel'},
  grading: {file: '17-grading', alt: 'Huddles inspecting a comic with a magnifier'},
  error: {file: '18-error', alt: 'Huddles crashed upside down into a pile of comics'},
  loading: {file: '19-loading', alt: 'Huddles running with a stack of comics'},
  listing: {file: '20-listing', alt: 'Huddles photographing a comic'},
  notifications: {file: '22-notifications', alt: 'Huddles with a megaphone and ringing bell'},
} as const;

export type HuddlesPose = keyof typeof huddlesPoses;
export type HuddlesSize = 'xl' | 'lg' | 'md' | 'sm';
const pixels: Record<HuddlesSize, number> = {xl: 360, lg: 260, md: 180, sm: 72};

export function huddlesSrc(pose: HuddlesPose, format: 'webp' | 'png' = 'webp') {
  return `/mascot/huddles-${huddlesPoses[pose].file}.${format}`;
}

/** Just the artwork, no panel. Use for small inline spots (toasts, badges, cards). */
export function HuddlesArt({pose, size = 'md', decorative = false, className = ''}: {pose: HuddlesPose; size?: HuddlesSize; decorative?: boolean; className?: string}) {
  const px = pixels[size];
  return <Image className={'huddles-art ' + className} src={huddlesSrc(pose)} width={px} height={px} alt={decorative ? '' : huddlesPoses[pose].alt} sizes={px + 'px'} unoptimized />;
}

export default function HuddlesGuide({pose, caption, line, size = 'lg', tone = 'yellow', className = ''}: {
  pose: HuddlesPose;
  caption?: string;
  line?: string;
  size?: HuddlesSize;
  tone?: 'yellow' | 'cream' | 'blue' | 'red';
  className?: string;
}) {
  if (size === 'sm') return <HuddlesArt pose={pose} size="sm" className={className} />;
  return <figure className={`huddles huddles-${size} huddles-tone-${tone} ${className}`}>
    <div className="huddles-panel">
      {caption && <figcaption className="huddles-caption">{caption}</figcaption>}
      {line && <p className="huddles-bubble">{line}</p>}
      <HuddlesArt pose={pose} size={size} className="huddles-figure" />
    </div>
  </figure>;
}
