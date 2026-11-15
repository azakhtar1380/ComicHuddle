import {ArrowRight,Clock,Package,ShieldCheck} from 'lucide-react';
import Link from 'next/link';
import './feature-info.css';
import SiteHeader from './site-header';
import SiteFooter from './site-footer';
import CollectorWallet from './collector-wallet';
import PageHeader from '../components/page-header';
import {HowItWorks} from '../components/states';
import {protectionConfig,type ProtectionEnv} from '../lib/commerce-protection';

function Steps({label,steps}:{label:string;steps:[string,string][]}){
 return <ol className={'fi-steps'+(steps.length>3?' fi-steps-many':'')} aria-label={label}>{steps.map(([title,body],index)=><li key={title}><span className="fi-step-num" aria-hidden="true">{index+1}</span><h3>{title}</h3><p>{body}</p></li>)}</ol>;
}

export default function FeatureInfo({kind}:{kind:'wallet'|'safepurchase'}){
 const wallet=kind==='wallet';
 // Read on the server: SafePurchase is only described as available when an inspection center is configured.
 const protection=protectionConfig(process.env as ProtectionEnv),live=protection.safePurchaseEnabled,threshold='$'+(protection.thresholdCents/100).toLocaleString('en-US');
 const fee=protection.feeCents?'$'+(protection.feeCents/100).toFixed(2):'';
 return <div className="fi-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section={wallet?'Wallet':'SafePurchase'} standalone/>
  <main id="main-content" tabIndex={-1} className="ds-wrap fi-main">
   {wallet?<>
    <PageHeader eyebrow="Wallet & rewards" title="Your wallet." accent="Your rewards." lede="Earn 1 point for every $1 you spend on comics. Shipping and tax don’t count." pose="wallet" caption="YOUR WALLET" line="Every $1 = 1 point."/>
    <section className="fi-section" aria-label="Your balances"><CollectorWallet showInfoLink={false}/></section>
    <section className="fi-section" aria-labelledby="fi-how">
     <div className="ds-section-head"><h2 id="fi-how">How rewards <span>work.</span></h2></div>
     <Steps label="How rewards work" steps={[
      ['Earn','Earn 1 point for every $1 you spend on comics. Shipping and tax don’t count.'],
      ['Redeem','Every 100 points = $1 in store credit.'],
      ['Spend','Use your credit at checkout. It covers the comic, not shipping or tax.'],
     ]}/>
     <HowItWorks title="Good to know">
      <p>Store credit works on ComicHuddle only. It can’t be cashed out or transferred.</p>
      <p>Points come from comics you pay for through ComicHuddle checkout. Bids, cash meetups and sales you mark yourself don’t earn points.</p>
      <p>If an order is refunded, the credit you used comes back. The points you earned on it are removed.</p>
      <p>Only you can see your wallet. Points from test checkouts stay separate from your real balance.</p>
     </HowItWorks>
    </section>
   </>:<>
    <PageHeader eyebrow="SafePurchase" title="A careful path" accent="for a valuable book." lede="We check your comic before it ships to you." pose="safepurchase" caption="SAFEPURCHASE" line="We check it before it ships." actions={live?<Link className="ds-btn ds-btn-primary" href="/?section=Marketplace">Shop the marketplace <ArrowRight size={18} aria-hidden="true"/></Link>:<Link className="ds-btn ds-btn-secondary" href="/?section=Marketplace">Browse the marketplace <ArrowRight size={18} aria-hidden="true"/></Link>}/>
    {!live&&<p className="fi-status" role="status"><Clock size={18} aria-hidden="true"/> SafePurchase isn’t open for orders yet.</p>}
    <section className="fi-section" aria-labelledby="fi-steps">
     <div className="ds-section-head"><h2 id="fi-steps">How it <span>works.</span></h2>{live&&<p>Automatic on orders of {threshold} or more.</p>}</div>
     <Steps label="How SafePurchase works" steps={[
      ['You pay','Pay through ComicHuddle checkout. We hold the money. The seller isn’t paid yet.'],
      ['Seller ships to us','The seller ships the comic to ComicHuddle, not to you, with tracking.'],
      ['We check it','Right issue, right printing, condition as described. It isn’t official grading.'],
      ['We ship it to you','Insured, with a signature. If the check fails, you get a full refund and the comic goes back to the seller.'],
      ['Seller gets paid','You have 48 hours after delivery to report a problem. Then the seller is paid.'],
     ]}/>
     <p className="fi-note">You and the seller see the same step-by-step progress on the order in Orders, with tracking numbers and our notes.</p>
     <p className="fi-callout"><ShieldCheck size={22} aria-hidden="true"/> You have 48 hours after delivery to report a problem.</p>
    </section>
    <section className="fi-section" aria-labelledby="fi-faq">
     <div className="ds-section-head"><h2 id="fi-faq">Questions<span>.</span></h2></div>
     {live&&<HowItWorks title="Which orders get it?">
      <p>It’s automatic on a comic or collection of {threshold} or more.</p>
      <p>Below that, the seller can offer it, or you can add it at checkout.</p>
      <p>{fee?'There’s a '+fee+' fee. You’ll see it at checkout before you pay.':'You’ll see any fee at checkout before you pay.'}</p>
     </HowItWorks>}
     <HowItWorks title="What do you check?">
      <p>The title, issue, variant, printing and year. That the condition matches the listing.</p>
      <p>Slab certification, and any restoration or pressing the seller didn’t mention. For a collection, we check every book.</p>
      <p>It isn’t official grading.</p>
     </HowItWorks>
     <HowItWorks title="How does shipping work?">
      <p>The seller ships to our inspection center, insured for the full price, and adds tracking within 48 hours.</p>
      <p>We check the book within 2 business days of arrival. Then it ships to you insured, with a signature.</p>
     </HowItWorks>
     <HowItWorks title="What if something’s wrong?">
      <p>After delivery, you have 48 hours to report a problem. Take photos and keep the packaging.</p>
      <p>Report it in Orders. The seller isn’t paid while we look into it.</p>
      <p>If only part of a collection fails, you pick a partial or full refund. Refunds go back to how you paid.</p>
     </HowItWorks>
     <HowItWorks title="I’m the seller. Where do I ship?">
      <p>To ComicHuddle. Our receiving address shows on the order once it’s paid, with the steps to follow.</p>
      <p>Insure it for the full price and add tracking in Orders within 48 hours.</p>
     </HowItWorks>
     <HowItWorks title="When does the seller get paid?">
      <p>After signed delivery, once the 48 hours pass with no problem reported.</p>
     </HowItWorks>
    </section>
    <div className="ds-actions fi-actions"><Link className="ds-btn ds-btn-secondary" href="/?section=Orders"><Package size={18} aria-hidden="true"/> Your orders</Link></div>
   </>}
  </main>
  <SiteFooter/>
 </div>;
}
