import Link from 'next/link';
import {operator} from '../lib/operator';
const columns:[string,[string,string][]][]=[
 ['Find',[['Comic Directory','/?section=Directory'],['Characters','/characters'],['Scan a comic','/?section=Scan']]],
 ['Buy & sell',[['Marketplace','/?section=Marketplace'],['Sell a comic','/?section=Marketplace&sell=single'],['Sell a collection','/?section=Marketplace&sell=collection'],['SafePurchase','/safepurchase']]],
 ['Collect',[['My collection','/?section=My%20Profile&ptab=collection'],['Comic Workshop','/?section=Comic+Workshop'],['Wallet & rewards','/wallet']]],
 ['Help',[['About us','/about'],['Meet Huddles','/about-huddles'],['Collector rules','/?section=Rules'],['Contact us','/contact'],['Sign in','/sign-in']]],
];
export default function SiteFooter(){return <footer className="ch-footer">
 <div className="ch-footer-grid">
  <div className="ch-footer-brand"><Link className="brand" href="/" aria-label="ComicHuddle home"><img className="brand-artwork" src="/brand/comichuddle-logo-cutout.webp" alt="ComicHuddle" width="297" height="240"/></Link><p>Know the book. Own the story. Built by collectors, for collectors.</p></div>
  {columns.map(([title,links])=><nav key={title} aria-label={title}><h3>{title}</h3>{links.map(([label,href])=><a key={label} href={href}>{label}</a>)}</nav>)}
 </div>
 <div className="footer-bottom"><span>© {new Date().getFullYear()} ComicHuddle. Independent. Not affiliated with any publisher or CGC.</span><span>For collectors 18+ in the United States.</span></div>
 <p className="footer-operator">Run by {operator.name} · {operator.jurisdiction} · <a href="/contact">Contact us</a></p>
 <p className="footer-license">Comic data from the <a href="https://www.comics.org/" target="_blank" rel="noreferrer">Grand Comics Database</a> and <a href="https://metron.cloud/" target="_blank" rel="noreferrer">Metron</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>). Cover art © its publishers and creators.</p>
</footer>}
