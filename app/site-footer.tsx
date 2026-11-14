import {operator} from '../lib/operator';
const columns:[string,[string,string][]][]=[
 ['Shop',[['Marketplace','/?section=Marketplace'],['Sell a comic','/?section=Marketplace&sell=single'],['Sell a collection','/?section=Marketplace&sell=collection'],['SafePurchase','/safepurchase']]],
 ['Collect',[['Comic Directory','/?section=Directory'],['Scan a comic','/?section=Scan'],['My Collection','/?section=My+Profile'],['Wallet & Rewards','/wallet']]],
 ['Services',[['Comic Workshop','/?section=Comic+Workshop'],['Coming Soon','/upcoming']]],
 ['Help',[['About, data & rules','/?rules=1'],['Contact support','mailto:'+operator.supportEmail],['Sign in','/sign-in']]],
];
export default function SiteFooter(){return <footer className="ch-footer">
 <div className="ch-footer-grid">
  <div className="ch-footer-brand"><a className="brand" href="/" aria-label="ComicHuddle home"><img className="brand-artwork" src="/brand/comichuddle-hero-logo-compact.svg" alt="ComicHuddle" width="1254" height="1010"/></a><p>Every issue. Every story. Your universe. The collector marketplace and directory built by fans, for fans.</p></div>
  {columns.map(([title,links])=><nav key={title} aria-label={title}><h3>{title}</h3>{links.map(([label,href])=><a key={label} href={href}>{label}</a>)}</nav>)}
 </div>
 <div className="footer-bottom"><span>© {new Date().getFullYear()} ComicHuddle. Independent collector platform; not affiliated with any publisher or CGC.</span><span className="ch-pay-badges" aria-label="Accepted payment methods"><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Apple Pay</span><span>Google Pay</span></span></div>
 <p className="footer-operator">Operated by {operator.name} · {operator.jurisdiction} · United States only · <a href={'mailto:'+operator.supportEmail}>Contact support</a></p>
 <p className="footer-license">Catalog metadata courtesy of the <a href="https://www.comics.org/" target="_blank" rel="noreferrer">Grand Comics Database</a> and <a href="https://metron.cloud/" target="_blank" rel="noreferrer">Metron</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Cover art © its respective publishers and creators.</p>
</footer>}
