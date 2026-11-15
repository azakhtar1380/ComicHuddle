import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import OffersClient from './offers-client';
import './offers.css';

export const metadata:Metadata={title:'Offers & trades | ComicHuddle',description:'Offers and trade proposals you have received and sent: accept, counter or decline, and pay for accepted offers.',robots:{index:false}};

export default function OffersPage(){
 return <div className="offers-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Offers" standalone/>
  <main id="main-content" className="of-main">
   <header className="of-hero">
    <span className="of-kicker">Marketplace</span>
    <h1>Offers &amp; trades</h1>
    <p>Every offer and trade proposal you’ve received or sent. Offers expire 48 hours after the last reply.</p>
   </header>
   <OffersClient/>
  </main>
  <SiteFooter/>
 </div>;
}
