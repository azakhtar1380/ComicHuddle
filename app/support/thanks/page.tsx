import type {Metadata} from 'next';
import Link from 'next/link';
import SiteHeader from '../../site-header';
import SiteFooter from '../../site-footer';
import HuddlesGuide from '../../../components/huddles-guide';
import {SUPPORT_DISCLOSURE,supportStatus} from '../../../lib/support-payments';
import '../../info-pages.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Thank you | ComicHuddle',robots:{index:false,follow:false}};

/** Thank-you page after Stripe Checkout. It only shows what the signed webhook has confirmed. */
export default async function SupportThanks({searchParams}:{searchParams:Promise<{ref?:string}>}){
 const {ref}=await searchParams,status=ref?await supportStatus(ref):null,paid=status?.status==='paid';
 return <div className="info-page">
  <SiteHeader section="AboutUs" standalone/>
  <main id="main-content" className="info-main">
   <section className="info-hero" aria-labelledby="thanks-title">
    <div>
     <p className="ds-eyebrow">Support ComicHuddle</p>
     <h1 id="thanks-title" className="info-display">Thank <span>you!</span></h1>
     <p className="info-lede">{paid?'We received your support of $'+(status!.amountCents/100).toFixed(2)+'. It helps keep ComicHuddle running and improving.':'Your payment is being confirmed by Stripe. This usually takes a few seconds. You can refresh this page.'}</p>
     <p className="info-note">{SUPPORT_DISCLOSURE} Stripe emails your receipt.</p>
     <p><Link className="ds-btn ds-btn-primary" href="/">Back to ComicHuddle</Link></p>
    </div>
    <HuddlesGuide pose="thank-you" size="lg" className="info-hero-art"/>
   </section>
  </main>
  <SiteFooter/>
 </div>;
}
