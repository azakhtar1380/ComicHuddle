import type {Metadata} from 'next';
import Link from 'next/link';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import {VerifiedBadge,VerifiedMark} from '../../components/verified-badge';
import './verified.css';

export const metadata:Metadata={title:'Verified Collectors and Businesses | ComicHuddle',description:'What the blue verified check means on ComicHuddle, and how collectors, comic shops and dealers get it.'};

export default function VerifiedPage(){
 return <div className="vf-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Verified" standalone/>
  <main id="main-content" className="vf-main">
   <section className="vf-hero">
    <span className="vf-mark" aria-hidden="true"><VerifiedMark size={72}/></span>
    <div>
     <p className="vf-kicker">Verified collectors and businesses</p>
     <h1>The blue check means a real person or a real shop.</h1>
     <p className="vf-lede">There are two kinds, with the same blue check. A collector shows <VerifiedBadge kind="person" label/> once we’ve confirmed they’re a real person. A comic shop or dealer shows <VerifiedBadge kind="business" label/> once we’ve confirmed the business is real.</p>
    </div>
   </section>

   <section className="vf-card" aria-labelledby="vf-where">
    <h2 id="vf-where">Where you’ll see it</h2>
    <ul>
     <li>Right after the name on the profile, the share card and the link preview.</li>
     <li>Next to the seller on their listings, and in offers.</li>
     <li>Next to the name in your messages.</li>
    </ul>
    <p className="vf-quiet">A verified business also gets a small blue “Shop” tag. Star ratings are separate: anyone with reviews from completed orders shows stars, verified or not.</p>
   </section>

   <section className="vf-card" aria-labelledby="vf-means">
    <h2 id="vf-means">What it means, and what it doesn’t</h2>
    <dl className="vf-facts">
     <div><dt>It means</dt><dd>For a collector: we contacted them and confirmed they’re a real person. For a business: a ComicHuddle admin checked by hand that it is a real comic shop or dealer, and that the shop name and location on the profile match it.</dd></div>
     <div><dt>It doesn’t mean</dt><dd>That ComicHuddle guarantees a sale, a grade or a price. Read the seller’s policies before you buy.</dd></div>
    </dl>
   </section>

   <section className="vf-card" aria-labelledby="vf-person">
    <h2 id="vf-person">How a collector gets the check</h2>
    <ol>
     <li>Open your account panel and choose <b>Get verified</b>.</li>
     <li>We contact you to confirm you’re a real person.</li>
     <li>A ComicHuddle admin turns the check on by hand, and you get a notification.</li>
    </ol>
    <p className="vf-quiet">Admins can remove the check, and you’re told when that happens.</p>
   </section>

   <section className="vf-card" aria-labelledby="vf-get">
    <h2 id="vf-get">How a business gets the check</h2>
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
