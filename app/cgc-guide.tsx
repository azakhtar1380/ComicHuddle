import {ArrowUpRight} from 'lucide-react';
import {goCollectComicGuideUrl} from '../lib/value-links';

export default function CgcGuide(){
 return <div className="cgc-guide"><div><span className="eyebrow">CGC VALUES / EXTERNAL PRICE GUIDE</span><h3>GRADED? HEAD TO GOCOLLECT.</h3><p>Search your exact comic, grade and label on GoCollect. Its sign-in or plan requirements apply; values are not imported into ComicHuddle.</p></div><a className="button dark" href={goCollectComicGuideUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the GoCollect comic price guide in a new tab">Open CGC price guide <ArrowUpRight size={18}/></a></div>;
}

export function FmvMethod(){
 return <details className="fmv-method"><summary>How our own FMV would work</summary><div><strong>Independent model · research prototype</strong><p>Match the exact edition, variant, printing and raw condition. Use verified, permitted completed sales from the last 90 days. Asking prices, lots, canceled or refunded purchases and unknown accepted-offer prices do not count.</p><p>Weight recent sales more heavily: a sale 30 days old receives half the weight of a sale today. The midpoint is the weighted median, with the middle 50% of observed prices shown as a sale range. That range is not a statistical confidence interval.</p><p>Require at least five comparable sales across three independent sellers, with a sale in the last 30 days. Check duplicates, unusual prices and seller concentration. Show the sample size, dates and evidence quality; show unavailable when the evidence is too thin.</p><p>This model is not connected to a live feed and still needs market backtesting. Any source must permit collection, derived valuations and public display. CGC research opens GoCollect separately.</p></div></details>;
}
