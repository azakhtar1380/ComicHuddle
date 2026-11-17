// Origin Story #1: the five-panel profile setup that unlocks the Origin Story trophy.
import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import {getChatGPTUser} from '../chatgpt-auth';
import OriginSetup from '../../components/trophies/origin-setup';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Your origin story | ComicHuddle',description:'Five panels to finish your ComicHuddle profile and unlock the Origin Story trophy.'};
export default async function OriginStoryPage(){
 const user=await getChatGPTUser();
 return <div>
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Origin story" standalone/>
  <main id="main-content" style={{padding:'28px 16px 40px'}}>
   {user?<OriginSetup/>:<p style={{textAlign:'center'}}><a href="/sign-in?return_to=%2Forigin-story">Sign in</a> to finish your origin story.</p>}
  </main>
  <SiteFooter/>
 </div>;
}
