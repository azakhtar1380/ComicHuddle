'use client';
import {Database} from 'lucide-react';
import CatalogSyncPanel from './catalog-sync-panel';
export default function DataStudio({notify,onUpdated}:{notify:(value:string)=>void;onUpdated:()=>void}){return <section className="data-studio"><div className="page-intro"><div><div className="eyebrow">SITE OWNER / DATA STUDIO</div><h1>GOOD DATA.<br/><span>REAL PROVENANCE.</span></h1><p>Maintain the shared bibliographic catalog. Source access, artwork permissions and image storage are separate requirements.</p></div><Database size={44}/></div><CatalogSyncPanel notify={notify} onUpdated={onUpdated}/><p>Pricing research, imports and automatic valuation are paused for launch. Historical records are retained. <a href="/upcoming#fmv">View Upcoming</a>.</p></section>}
