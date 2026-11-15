'use client';
import Link from 'next/link';
import HuddlesGuide from '../components/huddles-guide';

export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <main id="main-content" className="ds-wrap status-page">
  <div className="status-copy">
   <p className="ds-eyebrow">Something broke</p>
   <h1 className="ds-title">Ka-blam!<br/><span>That didn&apos;t load.</span></h1>
   <p className="ds-lede">Something went wrong on our side. Try again.</p>
   <div className="ds-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={reset}>Try again</button><Link className="ds-btn ds-btn-secondary" href="/">Go home</Link></div>
  </div>
  <HuddlesGuide pose="error" caption="KA-BLAM!" line="Even heroes miss a panel." size="lg"/>
 </main>;
}
