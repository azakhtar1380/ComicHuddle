// Trophy case: "{n} of 15 trophies earned", three groups, fair-play rules and notification switches.
import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import {getChatGPTUser} from '../chatgpt-auth';
import {TrophyCase,TrophyUnlock} from '../../components/trophies/trophy-ui';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Trophies | ComicHuddle',description:'Your ComicHuddle trophy case: Bronze, Silver and Golden Age tiers for collecting, selling and the community.'};
export default async function TrophiesPage(){
 const user=await getChatGPTUser();
 return <div className="tr-shell">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Trophies" standalone/>
  <main id="main-content" style={{padding:'24px 16px'}}>
   {user?<><TrophyUnlock signedIn/><TrophyCase/></>:<section className="tr-page"><div className="tr-head"><h1>Trophies</h1></div><p className="tr-note"><a href="/sign-in?return_to=%2Ftrophies">Sign in</a> to see your trophy case.</p></section>}
  </main>
  <SiteFooter/>
 </div>;
}
