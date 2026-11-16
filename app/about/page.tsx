import type {Metadata} from 'next';
import Link from 'next/link';
import {ArrowRight, BookOpen, Layers, Mail, ShoppingBag, Users, Wrench} from 'lucide-react';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import HuddlesGuide from '../../components/huddles-guide';
import {operator} from '../../lib/operator';
import SupportComicHuddle from '../../components/support-comichuddle';
import '../info-pages.css';

export const metadata: Metadata = {
  title: 'About us | ComicHuddle',
  description: 'ComicHuddle is a comic book marketplace and community for collectors: look up any issue, track your collection, and buy, sell or trade with other collectors.',
};

const offers = [
  {Icon: BookOpen, title: 'A directory of comics', line: 'Look up issues from the 1930s to this week, with creators, characters and first appearances.', href: '/?section=Directory', cta: 'Open the directory'},
  {Icon: Layers, title: 'Your collection, organized', line: 'Scan or search to add the comics you own, with grade, notes and photos, all in one place.', href: '/?section=Collection', cta: 'Start your collection'},
  {Icon: ShoppingBag, title: 'A marketplace for collectors', line: 'Buy, sell, make offers and trade single issues or whole collections with other collectors.', href: '/?section=Marketplace', cta: 'Visit the marketplace'},
  {Icon: Wrench, title: 'Comic Workshop', line: 'Find people who press, clean and prep comics for grading.', href: '/?section=Comic+Workshop', cta: 'Find a pro'},
  {Icon: Users, title: 'Every character', line: 'See where heroes and villains first appeared and every issue they show up in.', href: '/characters', cta: 'Browse characters'},
];

export default function AboutPage() {
  return <div className="info-page">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <SiteHeader section="AboutUs" standalone />
    <main id="main-content" className="info-main">
      <section className="info-hero" aria-labelledby="about-title">
        <div>
          <p className="ds-eyebrow">About us</p>
          <h1 id="about-title" className="info-display">Made by collectors,<br /><span>for collectors.</span></h1>
          <p className="info-lede">ComicHuddle is a comic book marketplace and community. It brings together the things collectors do every day: looking up an issue, keeping track of what you own, and buying, selling or trading with people who care about comics as much as you do.</p>
        </div>
        <HuddlesGuide pose="home" size="lg" className="info-hero-art" />
      </section>

      <section className="info-section" aria-labelledby="about-what">
        <h2 id="about-what" className="info-h2">What you can do <span>here</span></h2>
        <ul className="info-cards">{offers.map(({Icon, title, line, href, cta}) => <li key={title} className="info-card">
          <span className="info-card-icon"><Icon size={22} aria-hidden /></span>
          <h3>{title}</h3><p>{line}</p>
          <Link href={href} className="info-card-link">{cta} <ArrowRight size={15} aria-hidden /></Link>
        </li>)}</ul>
      </section>

      <section className="info-section info-split" aria-labelledby="about-why">
        <div>
          <h2 id="about-why" className="info-h2">Why we <span>built it</span></h2>
          <p>Collecting comics usually means juggling a price guide, a spreadsheet, a marketplace and a group chat. We wanted one place that knows the books, keeps your collection straight, and makes buying and selling between collectors simple and fair.</p>
          <p>Our members&apos; photos are the heart of the directory: when a seller lists a comic, the photo of their copy can become that issue&apos;s cover for everyone.</p>
        </div>
        <div className="info-facts" aria-label="Company facts">
          <dl>
            <div><dt>Run by</dt><dd>{operator.name}</dd></div>
            <div><dt>Based in</dt><dd>{operator.jurisdiction}</dd></div>
            <div><dt>Open to</dt><dd>Collectors 18+ in the United States</dd></div>
            <div><dt>Independent</dt><dd>Not affiliated with any publisher or CGC</dd></div>
          </dl>
          <Link href="/contact" className="ds-btn ds-btn-primary"><Mail size={18} aria-hidden /> Contact us</Link>
        </div>
      </section>

      <section className="info-section info-meet" aria-labelledby="about-huddles">
        <HuddlesGuide pose="portrait" size="md" className="info-meet-art" />
        <div>
          <h2 id="about-huddles" className="info-h2">Meet <span>Huddles</span></h2>
          <p>The hero from our logo shows up all over the site to help you find your way.</p>
          <Link href="/about-huddles" className="info-card-link">Meet Huddles <ArrowRight size={15} aria-hidden /></Link>
        </div>
      </section>

      <SupportComicHuddle id="support"/>

      <section className="info-section info-credits" aria-labelledby="about-credits">
        <h2 id="about-credits">Where our comic data comes from</h2>
        <p>Issue data from <a href="https://metron.cloud/" target="_blank" rel="noreferrer">Metron</a> (metron.cloud), licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Catalog data also comes from the <a href="https://www.comics.org/" target="_blank" rel="noreferrer">Grand Comics Database</a> under the same license. ComicHuddle has formatted and combined this data, and the Metron-based data in our directory is shared under CC BY-SA 4.0 too. That license doesn&apos;t cover our software or members&apos; listings.</p>
        <p>Cover art belongs to its publishers and creators.</p>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
