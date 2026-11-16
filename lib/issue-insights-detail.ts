// Pure helpers for the comic detail card (app/issue-showcase.tsx): which fields are shown and
// where each one comes from. Nothing here invents data: every value is read from the issue record
// (GCD bibliography, curated catalog entry) or the Metron/Wikidata issue profile, and each result
// carries the source it came from so the card can label it.
import type {GcdBibliography,Issue} from './catalog';
import {catalog as curatedCatalog} from './catalog';

export type Provenance='Metron'|'GCD'|'Wikidata'|'Catalog entry';
export type CreditLine={names:string[];source:Provenance;note?:string};
export type DetailCredits={writers:CreditLine|null;artists:CreditLine|null;covers:CreditLine|null};

/** Placeholder edition strings written by the catalog when no edition is recorded. */
const PLACEHOLDER_VARIANT=/^(original issue · printing to be confirmed|edition record · printing must be confirmed|edition not recorded)$/i;
const NOT_RECORDED=/^(not recorded|multiple contributors|unknown|none|\?)$/i;

const unique=(names:string[])=>[...new Map(names.map(n=>[n.toLowerCase(),n])).values()];

/** GCD credit text ("Bob Kane (signed); Jerry Robinson (sourced) (see notes)") -> clean names. */
export function gcdCreditNames(text:string|null|undefined):string[]{
 if(!text)return [];
 return text.split(';').map(part=>part.replace(/\[[^\]]*\]/g,'').replace(/\([^)]*\)/g,'').replace(/\?/g,'').replace(/\s+/g,' ').trim())
  .filter(name=>name&&!NOT_RECORDED.test(name)&&!/^(various|uncredited|typeset)$/i.test(name));
}

/** Writer / interior artist / cover artist, by source priority: Metron credits, GCD story credits, curated catalog entry. */
export function detailCredits(issue:Pick<Issue,'writer'|'artist'|'coverArtist'|'bibliography'|'gcdId'>,metron:{name:string;roles:string[]}[]):DetailCredits{
 const pick=(re:RegExp,exclude?:RegExp)=>unique(metron.filter(c=>c.roles.some(r=>re.test(r)&&!(exclude&&exclude.test(r)))).map(c=>c.name));
 const out:DetailCredits={writers:null,artists:null,covers:null};
 if(metron.length){
  const w=pick(/writer|script|story|plot/i),a=pick(/artist|pencil|illustrat|breakdown/i,/cover/i),c=pick(/cover/i);
  if(w.length)out.writers={names:w,source:'Metron'};
  if(a.length)out.artists={names:a,source:'Metron'};
  // Metron lists every cover artist of an issue, variant covers included.
  if(c.length)out.covers={names:c,source:'Metron',note:c.length>2?'All covers, including variants':undefined};
 }
 const stories=(issue.bibliography?.stories||[]);
 const comic=stories.filter(s=>!/cover/i.test(s.type));
 const coverStory=stories.find(s=>/cover/i.test(s.type));
 if(!out.writers){const w=unique(comic.flatMap(s=>gcdCreditNames(s.script)));if(w.length)out.writers={names:w,source:'GCD'}}
 if(!out.artists){const a=unique(comic.flatMap(s=>gcdCreditNames(s.pencils)));if(a.length)out.artists={names:a,source:'GCD'}}
 if(!out.covers&&coverStory){const c=unique(gcdCreditNames(coverStory.pencils));if(c.length)out.covers={names:c,source:'GCD'}}
 // Curated (hand-entered) catalog fields; native GCD rows carry "Not recorded" placeholders here.
 const curated=(value:string|undefined)=>value&&!NOT_RECORDED.test(value.trim())?value.split(/\s*\/\s*/).map(v=>v.trim()).filter(Boolean):[];
 if(!out.writers&&curated(issue.writer).length)out.writers={names:curated(issue.writer),source:'Catalog entry'};
 if(!out.artists&&curated(issue.artist).length)out.artists={names:curated(issue.artist),source:'Catalog entry'};
 if(!out.covers&&curated(issue.coverArtist).length)out.covers={names:curated(issue.coverArtist),source:'Catalog entry'};
 return out;
}

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
/** GCD dates: "1940-04-25" -> "April 25, 1940"; "1940-04-00" -> "April 1940"; "1940-00-00" -> "1940". */
export function gcdDate(text:string|null|undefined):string|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec((text||'').trim());if(!m)return null;
 const month=Number(m[2]),day=Number(m[3]);
 if(!month||month>12)return m[1];
 return day?MONTHS[month-1]+' '+day+', '+m[1]:MONTHS[month-1]+' '+m[1];
}
/** Release information that is actually recorded: on-sale date and cover date (GCD), else the catalog year. */
export function releaseInfo(issue:Pick<Issue,'year'|'bibliography'>):{onSale:string|null;coverDate:string|null;year:number|null;source:Provenance|null}{
 const b=issue.bibliography;
 const onSale=gcdDate(b?.onSaleDate),coverDate=(b?.publicationDate||'').trim()||gcdDate(b?.keyDate);
 if(onSale||coverDate)return {onSale,coverDate:coverDate||null,year:null,source:'GCD'};
 return {onSale:null,coverDate:null,year:issue.year>0?issue.year:null,source:issue.year>0?'Catalog entry':null};
}

/** A recorded edition: variant name, or "variant of" another GCD record. Placeholders are hidden. */
export function editionInfo(issue:Pick<Issue,'variant'|'bibliography'>):{label:string;variantOfUrl:string|null}|null{
 const name=(issue.variant||'').trim(),variantOf=issue.bibliography?.variantOf??null;
 const real=name&&!PLACEHOLDER_VARIANT.test(name)?name:null;
 if(variantOf)return {label:real?'Variant edition: '+real:'Variant edition',variantOfUrl:'https://www.comics.org/issue/'+variantOf+'/'};
 return real?{label:real,variantOfUrl:null}:null;
}

/** First appearances that GCD indexers recorded in a story's character list, e.g.
 * "Rhino [Aleksei Sytsevich] (antagonist) (first appearance)" or "The Joker (villain) (introduction)". */
export type GcdFirstAppearance={name:string;qualifier:string};
export function gcdFirstAppearances(bibliography:GcdBibliography|null|undefined):GcdFirstAppearance[]{
 const out=new Map<string,GcdFirstAppearance>();
 for(const story of bibliography?.stories||[]){
  if(/cover/i.test(story.type))continue;
  for(const raw of splitCharacters(story.characters)){
   const notes=[...raw.matchAll(/\(([^()]*)\)/g)].map(m=>m[1].trim().toLowerCase());
   const hit=notes.find(n=>/^(first (full )?appearance|introduction)$/.test(n));
   if(!hit)continue;
   const name=raw.replace(/^[A-Z][A-Za-z ]{1,20}:\s*/,'').replace(/\[[^\]]*\]/g,'').replace(/\([^)]*\)/g,'').replace(/\s+/g,' ').trim();
   if(!name||name.length>80)continue;
   const qualifier=hit==='introduction'?'first appearance':hit+(notes.includes('cameo')?' (cameo)':'');
   if(!out.has(name.toLowerCase()))out.set(name.toLowerCase(),{name,qualifier});
  }
 }
 return [...out.values()].slice(0,12);
}
/** GCD character list -> names (brackets and notes removed), for issues without Metron characters. */
export function gcdCharacterNames(bibliography:GcdBibliography|null|undefined):string[]{
 const names=(bibliography?.stories||[]).filter(s=>!/cover/i.test(s.type)).flatMap(s=>splitCharacters(s.characters))
  .map(raw=>raw.replace(/^[A-Z][A-Za-z ]{1,20}:\s*/,'').replace(/\[[^\]]*\]/g,'').replace(/\([^)]*\)/g,'').replace(/\s+/g,' ').trim())
  .filter(name=>name&&name.length<=80&&!/^(un-?named|various|none)\b/i.test(name));
 return unique(names).slice(0,40);
}
/** Split on ";" outside brackets/parentheses. */
function splitCharacters(text:string|null|undefined):string[]{
 const out:string[]=[];let depth=0,current='';
 for(const ch of text||''){
  if(ch==='['||ch==='(')depth++;else if((ch===']'||ch===')')&&depth>0)depth--;
  if(ch===';'&&depth===0){if(current.trim())out.push(current.trim());current=''}else current+=ch;
 }
 if(current.trim())out.push(current.trim());
 return out;
}

/** Curated catalog note, shown only when it makes no key-issue / first-appearance claim. GCD
 * indexer notes (native GCD rows) are bibliographic notes, not a description, and are not shown here. */
export function catalogNote(issue:Pick<Issue,'note'|'gcdId'>):string|null{
 const note=(issue.note||'').trim();
 if(!note||issue.gcdId||/^GCD bibliographic record/i.test(note))return null;
 return /\b(first|debut|key|introduc|begins|origin|landmark|enters|joins|staple|early .* appearance)/i.test(note)?null:note;
}
/** Curated hand-entered character names, minus non-character placeholders ("Science-fiction anthology"). */
export function catalogCharacters(issue:Pick<Issue,'characters'>):string[]{
 return (issue.characters||[]).filter(name=>name&&!/anthology|multiple|various/i.test(name));
}
/** Hand-checked key-issue facts (lib/catalog.ts, reviewed Nov 2026) for the curated issues only, matched by
 *  series, number and year, so a directory record of the same comic shows them too. Other issues show no key claim. */
export function curatedKeyFact(issue:Pick<Issue,'title'|'number'|'year'>):{kind:string;note:string}|null{
 const norm=(value:string)=>value.toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();
 const title=norm(issue.title),number=String(issue.number).replace(/^#/,'').trim();
 const hit=curatedKeyIssues().find(entry=>norm(entry.title)===title&&entry.number===number&&(!issue.year||!entry.year||entry.year===issue.year));
 return hit?{kind:hit.kind,note:hit.note}:null;
}
let keyIssues:Issue[]|null=null;
function curatedKeyIssues(){return keyIssues??=curatedCatalog.filter(entry=>['Key issue','First appearance'].includes(entry.kind)&&!!entry.note)}
