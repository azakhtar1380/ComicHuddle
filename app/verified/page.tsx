import type {Metadata} from 'next';
import Link from 'next/link';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import {VerifiedBadge,VerifiedMark} from '../../components/verified-badge';
import './verified.css';

export const metadata:Metadata={title:'Verified Businesses | ComicHuddle',description:'What the blue Verified business tick means on ComicHuddle, and how comic shops and dealers get it.'};

export default function VerifiedPage(){
 return <div className="vf-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Verified" standalone/>
  <main id="main-content" className="vf-main">
   <section className="vf-hero">
    <span className="vf-mark" aria-hidden="true"><VerifiedMark size={72}/></span>
    <div>
     <p className="vf-kicker">Verified businesses</p>
     <h1>The blue tick means a real shop.</h1>
     <p className="vf-lede">Comic shops and dealers can run a Business profile on ComicHuddle. When a ComicHuddle admin has checked that the business is real, its name shows the <VerifiedBadge label/> tick.</p>
    </div>
   </section>

   <section className="vf-card" aria-labelledby="vf-where">
    <h2 id="vf-where">Where you’ll see it</h2>
    <ul>
     <li>Next to the shop name on its profile.</li>
     <li>Next to the seller on its listings.</li>
     <li>Next to the name in your messages with that business.</li>
    </ul>
    <p className="vf-quiet">Collectors with a personal profile never show the tick. It is only for businesses.</p>
   </section>

   <section className="vf-card" aria-labelledby="vf-means">
    <h2 id="vf-means">What it means, and what it doesn’t</h2>
    <dl className="vf-facts">
     <div><dt>It means</dt><dd>A ComicHuddle admin checked by hand that this is a real comic shop or dealer, and that the shop name and location on the profile match it.</dd></div>
     <div><dt>It doesn’t mean</dt><dd>That ComicHuddle guarantees a sale, a grade or a price. Read the shop’s shipping and returns policies on its profile before you buy.</dd></div>
    </dl>
   </section>

   <section className="vf-card" aria-labelledby="vf-get">
    <h2 id="vf-get">How a business gets the tick</h2>
    <ol>
     <li>Create your free profile and choose <b>Business</b>. You can switch any time in your profile or Settings.</li>
     <li>Add your shop name, logo, city and state, website, and your shipping and returns policies.</li>
     <li>A ComicHuddle admin reviews business profiles by hand. If everything checks out, the tick appears and you get a notification.</li>
    </ol>
    <p className="vf-quiet">If you change your shop name, website, city or state, the tick comes off until an admin checks again. Admins can also remove it, and the business is told when that happens.</p>
    <p><Link className="vf-cta" href="/?section=Collectors">Set up my profile</Link></p>
   </section>
  </main>
  <SiteFooter/>
 </div>;
}
