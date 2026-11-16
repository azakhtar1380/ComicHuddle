import type {Metadata} from 'next';
import Link from 'next/link';
import {ArrowRight, BookOpenCheck, Camera, HeartHandshake, ShieldCheck} from 'lucide-react';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import HuddlesGuide, {HuddlesArt, type HuddlesPose} from '../../components/huddles-guide';
import './about-huddles.css';

export const metadata: Metadata = {
  title: 'Meet Huddles | ComicHuddle',
  description: 'Meet Huddles, the hero from the ComicHuddle logo and your guide to every corner of the site.',
};

const jobs: {pose: HuddlesPose; title: string; line: string; href?: string; cta?: string}[] = [
  {pose: 'directory', title: 'Finds any issue', line: 'Search the whole directory in seconds.', href: '/?section=Directory', cta: 'Search the directory'},
  {pose: 'scanner', title: 'Scans your books', line: 'Point your phone. Add your comic.', href: '/?section=Scan', cta: 'Scan a comic'},
  {pose: 'add-comic', title: 'Keeps your longbox tidy', line: 'Every copy, every detail, all in one place.', href: '/?section=Collection', cta: 'Open your collection'},
  {pose: 'characters', title: 'Meets the characters', line: 'Every hero. Every villain.', href: '/characters', cta: 'Browse characters'},
  {pose: 'marketplace', title: 'Hunts the market', line: 'One grail or the whole longbox.', href: '/?section=Marketplace', cta: 'Visit the marketplace'},
  {pose: 'safepurchase', title: 'Guards your purchase', line: 'We check it before it ships.', href: '/safepurchase', cta: 'How SafePurchase works'},
  {pose: 'workshop', title: 'Finds a pro', line: 'Pressing and cleaning, near you.', href: '/?section=Comic+Workshop', cta: 'Find a pro'},
  {pose: 'thank-you', title: 'Says thanks', line: 'Every order gets a hero’s thank-you.'},
];

const code = [
  {Icon: BookOpenCheck, title: 'Know the book.', line: 'Get the issue, printing and condition right.'},
  {Icon: Camera, title: 'List it honest.', line: 'Real photos. Real condition. No surprises.'},
  {Icon: ShieldCheck, title: 'Treat every comic like a grail.', line: 'Bag it, board it, ship it safe.'},
  {Icon: HeartHandshake, title: 'Respect every collector.', line: 'New fans and old pros, same welcome.'},
];

const sightings: {pose: HuddlesPose; caption: string}[] = [
  {pose: 'empty', caption: 'Meanwhile…'},
  {pose: 'messages', caption: 'Say hi'},
  {pose: 'auction', caption: 'Going once…'},
  {pose: 'grading', caption: 'Grading 101'},
  {pose: 'error', caption: 'Lost a page'},
  {pose: 'loading', caption: 'On the way…'},
  {pose: 'listing', caption: 'Say cheese'},
  {pose: 'hero-vs-villain', caption: 'Hero vs. villain'},
];

export default function AboutHuddlesPage() {
  return <div className="ah-page">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <SiteHeader section="About" standalone />
    <main id="main-content" className="ah-main">
      <section className="ah-hero" aria-labelledby="ah-title">
        <div className="ah-hero-copy">
          <p className="ds-eyebrow">About Huddles</p>
          <h1 id="ah-title" className="ah-display">Meet<br /><span>Huddles.</span></h1>
          <p className="ah-lede">The hero from our logo, and your guide to every corner of ComicHuddle.</p>
        </div>
        <HuddlesGuide pose="portrait" size="xl" className="ah-hero-art" />
      </section>

      <section className="ah-origin" aria-labelledby="ah-who">
        <HuddlesGuide pose="origin" size="lg" tone="red" className="ah-origin-art" />
        <div className="ah-copy">
          <p className="ds-eyebrow">Origin story</p>
          <h2 id="ah-who" className="ah-h2">Who is <span>Huddles?</span></h2>
          <p>Huddles leapt off the cover of the ComicHuddle logo: fist up, cape out, ready for the next issue. Now he&apos;s the friend who shows you around.</p>
          <p className="ah-punch">He doesn&apos;t fight crime. He fights bent corners, lost back issues and bad trades.</p>
        </div>
      </section>

      <section className="ah-does" aria-labelledby="ah-does-title">
        <div className="ah-section-head">
          <p className="ds-eyebrow">His day job</p>
          <h2 id="ah-does-title" className="ah-h2">What Huddles <span>does</span></h2>
        </div>
        <ul className="ah-jobs">
          {jobs.map(job => <li key={job.pose} className="ah-job">
            <div className="ah-job-art"><span className="ah-job-spot" aria-hidden="true" /><HuddlesArt pose={job.pose} size="md" /></div>
            <h3>{job.title}</h3>
            <p>{job.line}</p>
            {job.href && job.cta && <Link href={job.href} className="ds-link ah-job-link">{job.cta}<ArrowRight size={16} aria-hidden="true" /></Link>}
          </li>)}
        </ul>
      </section>

      <section className="ah-why" aria-labelledby="ah-why-title">
        <div className="ah-copy">
          <p className="ds-eyebrow">The name</p>
          <h2 id="ah-why-title" className="ah-h2">Why <span>&ldquo;ComicHuddle&rdquo;?</span></h2>
          <p>A huddle is where a team leans in together. That&apos;s what this place is: collectors leaning in to share the hunt, swap the books and keep the stories going.</p>
          <p className="ah-punch">Your comics. Your people. One huddle.</p>
        </div>
        <HuddlesGuide pose="community" size="lg" className="ah-why-art" />
      </section>

      <section className="ah-code" aria-labelledby="ah-code-title">
        <div className="ah-section-head">
          <p className="ds-eyebrow">What he stands for</p>
          <h2 id="ah-code-title" className="ah-h2">The Huddles <span>Code</span></h2>
        </div>
        <div className="ah-code-body">
          <HuddlesGuide pose="oath" size="lg" tone="blue" className="ah-code-art" />
          <ul className="ah-values">
            {code.map(({Icon, title, line}) => <li key={title} className="ah-value">
              <span className="ah-value-icon" aria-hidden="true"><Icon size={20} /></span>
              <div><h3>{title}</h3><p>{line}</p></div>
            </li>)}
          </ul>
        </div>
      </section>

      <section className="ah-spot" aria-labelledby="ah-spot-title">
        <div className="ah-section-head">
          <p className="ds-eyebrow">Keep an eye out</p>
          <h2 id="ah-spot-title" className="ah-h2">Spot him <span>around the site</span></h2>
        </div>
        <div className="ah-strip" role="region" aria-label="Huddles poses from around the site (scrolls sideways)" tabIndex={0}>
          <ul>
            {sightings.map(s => <li key={s.pose}>
              <div className="ah-strip-art"><span className="ah-job-spot" aria-hidden="true" /><HuddlesArt pose={s.pose} size="md" /></div>
              <span className="ah-strip-caption">{s.caption}</span>
            </li>)}
          </ul>
        </div>
      </section>

      <section className="ah-cta" aria-labelledby="ah-cta-title">
        <div className="ah-cta-art"><span className="ah-job-spot" aria-hidden="true" /><HuddlesArt pose="sign-in" size="lg" /></div>
        <div className="ah-cta-copy">
          <h2 id="ah-cta-title" className="ah-h2">Ready to <span>huddle up?</span></h2>
          <p>Start your collection. It&apos;s free.</p>
          <div className="ah-cta-actions">
            <Link href="/sign-in?mode=register" className="ds-btn ds-btn-primary">Start your collection</Link>
            <Link href="/?section=Marketplace" className="ds-btn">Browse the marketplace</Link>
          </div>
        </div>
      </section>

      <section className="ah-credits" aria-labelledby="ah-credits-title">
        <h2 id="ah-credits-title">Where our comic data comes from</h2>
        <p>Issue data from <a href="https://metron.cloud/" target="_blank" rel="noreferrer">Metron</a> (metron.cloud), licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Catalog data also comes from the <a href="https://www.comics.org/" target="_blank" rel="noreferrer">Grand Comics Database</a> under the same license. ComicHuddle has formatted and combined this data, and the Metron-based data in our directory is shared under CC BY-SA 4.0 too. That license doesn&apos;t cover our software or members&apos; listings.</p>
        <p>Cover art belongs to its publishers and creators.</p>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
