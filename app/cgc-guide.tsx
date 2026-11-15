import {ArrowUpRight} from 'lucide-react';
import {goCollectComicGuideUrl} from '../lib/value-links';
import HuddlesGuide from '../components/huddles-guide';
import './cgc-guide.css';

export default function CgcGuide(){
 return <section className="cgc-guide-card" aria-labelledby="cgc-guide-title">
  <div className="cgc-guide-copy">
   <p className="ds-eyebrow">Grading guide</p>
   <h3 id="cgc-guide-title">Graded comic? <span>Check its value.</span></h3>
   <p>GoCollect tracks prices for CGC-graded comics. Search your comic, grade and label there.</p>
   <p className="cgc-guide-note">GoCollect is a separate site. Some features need an account. We don’t copy its prices into ComicHuddle.</p>
   <a className="ds-btn ds-btn-dark" href={goCollectComicGuideUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the GoCollect price guide (opens in a new tab)">Open the price guide <ArrowUpRight size={18} aria-hidden="true"/></a>
  </div>
  <HuddlesGuide pose="grading" caption="GRADING 101" line="Check the corners first." size="md" className="cgc-guide-art"/>
 </section>;
}

export function FmvMethod(){
 return <details className="fmv-method"><summary>How our own FMV would work</summary><div><strong>Independent model · research prototype</strong><p>Match the exact edition, variant, printing and raw condition. Use verified, permitted completed sales from the last 90 days. Asking prices, lots, canceled or refunded purchases and unknown accepted-offer prices do not count.</p><p>Weight recent sales more heavily: a sale 30 days old receives half the weight of a sale today. The midpoint is the weighted median, with the middle 50% of observed prices shown as a sale range. That range is not a statistical confidence interval.</p><p>Require at least five comparable sales across three independent sellers, with a sale in the last 30 days. Check duplicates, unusual prices and seller concentration. Show the sample size, dates and evidence quality; show unavailable when the evidence is too thin.</p><p>This model is not connected to a live feed and still needs market backtesting. Any source must permit collection, derived valuations and public display. CGC research opens GoCollect separately.</p></div></details>;
}
