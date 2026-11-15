import type {Metadata} from 'next';
import Link from 'next/link';
import SiteHeader from './site-header';
import SiteFooter from './site-footer';
import HuddlesGuide from '../components/huddles-guide';

export const metadata:Metadata={title:'Page not found | ComicHuddle'};

export default function NotFound(){
 return <>
  <SiteHeader standalone/>
  <main id="main-content" className="ds-wrap status-page">
   <div className="status-copy">
    <p className="ds-eyebrow">Page not found</p>
    <h1 className="ds-title">Ka-blam!<br/><span>Wrong panel.</span></h1>
    <p className="ds-lede">We couldn&apos;t find that page. It may have moved.</p>
    <div className="ds-actions"><Link className="ds-btn ds-btn-primary" href="/">Go home</Link><Link className="ds-btn ds-btn-secondary" href="/?section=Directory">Search the directory</Link></div>
   </div>
   <HuddlesGuide pose="error" caption="KA-BLAM!" line="Even heroes miss a panel." size="lg"/>
  </main>
  <SiteFooter/>
 </>;
}
