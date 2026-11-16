import type {Metadata} from 'next';
import Link from 'next/link';
import {Mail, MessageCircle, Phone} from 'lucide-react';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import HuddlesGuide from '../../components/huddles-guide';
import {operator} from '../../lib/operator';
import '../info-pages.css';

export const metadata: Metadata = {
  title: 'Contact us | ComicHuddle',
  description: 'Get in touch with the ComicHuddle team by email or phone.',
};

const topics = [
  {title: 'An order', line: 'Include your order number and what went wrong.'},
  {title: 'A listing or a member', line: 'Send a link to the listing or profile and tell us what you saw.'},
  {title: 'Your account', line: 'Write from the email address you signed up with.'},
  {title: 'The directory', line: 'Spotted a wrong issue detail or cover photo? Send the issue link.'},
];

export default function ContactPage() {
  return <div className="info-page">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <SiteHeader section="Contact" standalone />
    <main id="main-content" className="info-main">
      <section className="info-hero" aria-labelledby="contact-title">
        <div>
          <p className="ds-eyebrow">Contact us</p>
          <h1 id="contact-title" className="info-display">We&apos;re here<br /><span>to help.</span></h1>
          <p className="info-lede">Questions about an order, a listing or your account? Reach the ComicHuddle team directly.</p>
        </div>
        <HuddlesGuide pose="messages" size="lg" className="info-hero-art" />
      </section>

      <section className="info-section" aria-labelledby="contact-ways">
        <h2 id="contact-ways" className="info-h2">Get in <span>touch</span></h2>
        <ul className="info-cards info-contact">
          <li className="info-card">
            <span className="info-card-icon"><Mail size={22} aria-hidden /></span>
            <h3>Email</h3>
            <p><a className="info-contact-value" href={'mailto:' + operator.supportEmail}>{operator.supportEmail}</a></p>
            <p>The best way to reach us. Attach photos if they help.</p>
          </li>
          <li className="info-card">
            <span className="info-card-icon"><Phone size={22} aria-hidden /></span>
            <h3>Phone</h3>
            <p><a className="info-contact-value" href={operator.supportPhoneHref}>{operator.supportPhone}</a></p>
            <p>Call us. If we miss you, leave a message and we&apos;ll get back to you.</p>
          </li>
          <li className="info-card">
            <span className="info-card-icon"><MessageCircle size={22} aria-hidden /></span>
            <h3>On the site</h3>
            <p>Questions about a comic for sale? Message the seller from the listing.</p>
            <Link href="/?section=Messages" className="info-card-link">Open messages</Link>
          </li>
        </ul>
      </section>

      <section className="info-section" aria-labelledby="contact-topics">
        <h2 id="contact-topics" className="info-h2">Help us help you <span>faster</span></h2>
        <ul className="info-topics">{topics.map(topic => <li key={topic.title}><strong>{topic.title}</strong><span>{topic.line}</span></li>)}</ul>
        <p className="info-note">{operator.name} · {operator.jurisdiction}. ComicHuddle is for collectors 18+ in the United States.</p>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
