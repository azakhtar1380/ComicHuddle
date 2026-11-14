import type {Issue} from './catalog';
/**
 * Free cover identification from OCR text (or from an AI identification):
 * extract title / issue / publisher / year, build catalog queries, rank results.
 * Pure functions shared by the browser, the server route and the tests.
 */
export type OcrRegion='masthead'|'corner'|'full'|'rotated';
export type OcrLine={text:string;confidence:number;height:number;region:OcrRegion};
export type ComicHints={titles:string[];number:string|null;numberEvidence:'explicit'|'corner'|'none';year:number|null;publisher:string|null;queries:string[]};
export const PUBLISHERS:[name:string,pattern:RegExp][]=[
 ['Marvel',/\bmarvel\b/i],['DC',/\bdc\b|\bdc\s*comics\b|\bvertigo\b/i],['Image',/\bimage\b/i],['Dark Horse',/\bdark\s*horse\b/i],['IDW',/\bidw\b/i],
 ['BOOM! Studios',/\bboom!?\b/i],['Dynamite',/\bdynamite\b/i],['Archie',/\barchie\b/i],['Valiant',/\bvaliant\b/i],['Oni Press',/\boni\s*press\b/i],
 ['Titan',/\btitan\s*comics\b/i],['AfterShock',/\baftershock\b/i],['Vault',/\bvault\s*comics\b/i],['Mad Cave',/\bmad\s*cave\b/i],['Ablaze',/\bablaze\b/i],
 ['Scout',/\bscout\s*comics\b/i],['Zenescope',/\bzenescope\b/i],['Fantagraphics',/\bfantagraphics\b/i],['Gold Key',/\bgold\s*key\b/i],['Charlton',/\bcharlton\b/i],['Harvey',/\bharvey\b/i],['Fiction House',/\bfiction\s*house\b/i],
];
const NOISE=new Set('the a an of and comics comic presents issue no number vol volume price direct edition newsstand approved by code authority cca usa us can uk all new variant cover limited series story art by writer artist'.split(' '));
const words=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
function titleWords(value:string){return words(value).filter(word=>word.length>=2&&!/^\d+$/.test(word)&&!NOISE.has(word)&&!PUBLISHERS.some(([,pattern])=>pattern.test(word)))}
/** Likely OCR junk: few letters, many symbols. */
function plausible(line:string){const letters=(line.match(/[A-Za-z]/g)||[]).length;return letters>=3&&letters/Math.max(1,line.replace(/\s/g,'').length)>=.6}

export function extractComicHints(lines:OcrLine[]):ComicHints{
 const clean=lines.map(line=>({...line,text:line.text.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim()})).filter(line=>line.text&&line.confidence>=20);
 const all=clean.map(line=>line.text).join('\n');
 // Issue number: "#12", "No. 12", "Issue 12"; corner boxes on older books show a bare number.
 let number:string|null=null,numberEvidence:ComicHints['numberEvidence']='none';
 for(const line of [...clean.filter(l=>l.region==='corner'),...clean]){
  const match=line.text.match(/#\s*(\d{1,4}(?:\.\d)?)\b/)||line.text.match(/\b(?:no|n°|issue)\.?\s*(\d{1,4})\b/i);
  if(match){number=String(Number(match[1].split('.')[0]))+(match[1].includes('.')?'.'+match[1].split('.')[1]:'');numberEvidence='explicit';break}
 }
 if(!number){const bare=clean.find(line=>line.region==='corner'&&/^\d{1,3}$/.test(line.text)&&line.confidence>=55);if(bare){number=String(Number(bare.text));numberEvidence='corner'}}
 const yearMatch=all.match(/\b(19[3-9]\d|20[0-3]\d)\b/),year=yearMatch?Number(yearMatch[1]):null;
 const publisher=PUBLISHERS.find(([,pattern])=>pattern.test(all))?.[0]||null;
 // Title: the tallest plausible lines from the masthead first.
 const ranked=clean.filter(line=>plausible(line.text)&&titleWords(line.text).length>=1&&words(line.text).length<=8)
  .sort((a,b)=>Number(b.region==='masthead')-Number(a.region==='masthead')||b.height-a.height||b.confidence-a.confidence);
 const phrases=[...new Set(ranked.map(line=>titleWords(line.text).join(' ')).filter(text=>text.length>=3&&text.length<=60))].slice(0,3);
 const titles=[...phrases];if(phrases.length>=2)titles.splice(1,0,phrases[0]+' '+phrases[1]);
 return {titles:[...new Set(titles)].slice(0,4),number,numberEvidence,year,publisher,queries:buildCatalogQueries({titles,number})};
}
export function buildCatalogQueries(hints:{titles:string[];number:string|null}){
 const queries:string[]=[];
 for(const title of hints.titles.slice(0,3)){if(hints.number)queries.push(title+' #'+hints.number);queries.push(title)}
 return [...new Set(queries.map(query=>query.slice(0,150)))].slice(0,5);
}
/** Character-bigram Dice similarity, tolerant of OCR substitutions. */
export function similarity(a:string,b:string){
 const grams=(value:string)=>{const text=' '+words(value).join(' ')+' ',out=new Map<string,number>();for(let i=0;i<text.length-1;i++){const gram=text.slice(i,i+2);out.set(gram,(out.get(gram)||0)+1)}return out};
 const x=grams(a),y=grams(b);let overlap=0,total=0;for(const [gram,count] of x){overlap+=Math.min(count,y.get(gram)||0);total+=count}for(const count of y.values())total+=count;
 return total?2*overlap/total:0;
}
export type RankedIssue={issue:Issue;score:number;titleScore:number;numberMatch:boolean};
export function rankCatalogCandidates(hints:Pick<ComicHints,'titles'|'number'|'year'|'publisher'>,issues:Issue[]):RankedIssue[]{
 const seen=new Set<number>();
 return issues.filter(issue=>!seen.has(issue.id)&&seen.add(issue.id)).map(issue=>{
  const titleScore=Math.max(0,...hints.titles.map(title=>similarity(title,issue.title)));
  const numberMatch=!!hints.number&&issue.number.replace(/^#/,'').toLowerCase()===hints.number.toLowerCase();
  const publisherMatch=!!hints.publisher&&issue.publisher.toLowerCase().includes(hints.publisher.toLowerCase().replace('boom! studios','boom'));
  const yearMatch=!!hints.year&&Math.abs(issue.year-hints.year)<=1;
  const score=.55*titleScore+(numberMatch?.25:hints.number?-.1:0)+(publisherMatch?.1:0)+(yearMatch?.1:0);
  return {issue,score,titleScore,numberMatch};
 }).filter(row=>row.titleScore>=.45).sort((a,b)=>b.score-a.score||a.issue.id-b.issue.id);
}
