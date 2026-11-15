import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {Star} from 'lucide-react';
import SiteHeader from '../../site-header';
import SiteFooter from '../../site-footer';
import {getDb} from '../../../db';
import {characterPage,type CharacterPage} from '../../../lib/characters';
import CharacterComics from '../character-comics';
import {Portrait} from '../../issue-showcase';
import {HuddlesArt} from '../../../components/huddles-guide';
import '../characters.css';

export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};

async function load(raw:string):Promise<CharacterPage|null>{
 if(!/^-?[1-9][0-9]{0,9}$/.test(raw))return null;
 try{return await characterPage(getDb(),Number(raw))}catch{return null}
}
export async function generateMetadata({params}:Params):Promise<Metadata>{
 const character=await load((await params).id);
 if(!character)return {title:'Character | ComicHuddle'};
 return {title:character.name+' comics & first appearance | ComicHuddle',description:(character.description||'Every '+character.name+' comic in the ComicHuddle directory.').slice(0,160)};
}
/** Long Metron bios read better as short paragraphs. */
function paragraphs(text:string){return text.split(/\n+/).flatMap(block=>{const sentences=block.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)||[block];const out:string[]=[];for(let i=0;i<sentences.length;i+=3)out.push(sentences.slice(i,i+3).join('').trim());return out}).filter(Boolean)}

export default async function CharacterRoute({params}:Params){
 const character=await load((await params).id);
 if(!character)notFound();
 const first=character.firstAppearance,count=character.issueCount??(character.knownIssues||null);
 return <div className="character-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Characters" standalone/>
  <main id="main-content" className="cp-main">
   <nav className="cp-crumbs" aria-label="Breadcrumb"><Link href="/?section=Directory">Comic Directory</Link> <span aria-hidden="true">/</span> <span>Characters</span> <span aria-hidden="true">/</span> <span aria-current="page">{character.name}</span></nav>
   <section className="cp-hero">
    <Portrait name={character.name} src={character.portraitUrl} size="xl"/>
    <div className="cp-intro">
     <span className="cp-kicker">Comic character</span>
     <h1>{character.name}</h1>
     {character.aliases.length>0&&<p className="cp-aliases">Also known as {character.aliases.slice(0,6).join(', ')}</p>}
     <div className="cp-facts">
      {first&&<Link className="cp-fact cp-first" href={'/?section=Directory&issue='+first.issueId}><Star size={18} fill="currentColor"/><span><small>First appearance</small><strong>{first.title} #{first.number}</strong>{(first.publisher||first.year)&&<em>{[first.publisher,first.year].filter(Boolean).join(' · ')}</em>}</span></Link>}
      <div className="cp-fact"><span><small>Comic appearances</small><strong>{count?count.toLocaleString('en-US'):'Being gathered'}</strong>{count?<em>across the directory</em>:<em>Appearances are still being collected</em>}</span>{!count&&<HuddlesArt pose="hero-vs-villain" size="sm" className="cp-fact-huddles"/>}</div>
     </div>
    </div>
   </section>
   <section className="cp-about" aria-labelledby="cp-about-title">
    <HuddlesArt pose="hero-vs-villain" size="md" className="cp-about-huddles"/>
    <h2 id="cp-about-title">About {character.name}</h2>
    {character.description?paragraphs(character.description).map((text,index)=><p key={index}>{text}</p>):<p className="cp-quiet">A full biography for {character.name} hasn&apos;t been gathered yet. Check back soon.</p>}
    <p className="cp-source">Character data: {character.source}</p>
   </section>
   <CharacterComics characterId={character.characterId} name={character.name} firstIssueId={first?.issueId??null}/>
  </main>
  <SiteFooter/>
 </div>;
}
