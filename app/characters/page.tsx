import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import CharacterBrowser from './character-browser';
import './characters.css';

export const metadata:Metadata={title:'Comic Characters | ComicHuddle',description:'Browse and search comic book characters, their first appearances and every comic they appear in.'};

export default function CharactersPage(){
 return <div className="character-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Characters" standalone/>
  <main id="main-content" className="cp-main">
   <section className="cp-browse-hero">
    <span className="cp-kicker">Characters</span>
    <h1>Every hero. Every villain.</h1>
    <p>Search comic characters, see where they first appeared and browse every issue they&apos;re in.</p>
   </section>
   <CharacterBrowser/>
  </main>
  <SiteFooter/>
 </div>;
}
