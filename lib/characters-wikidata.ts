// Wikidata (CC0) comic-character first appearances: SPARQL queries, result parsing and the
// pure catalog matcher. Used by scripts/import-wikidata-first-appearances.ts.
// Wikidata models a first appearance (P4584) either as a comic-issue item (series P179,
// number P433 / P1545 qualifier / "Series #n" label, date P577, sometimes GCD issue ID P11308)
// or as a series item with issue (P433) and date (P577) qualifiers on the statement.
import {normalizeIssueNumber,normalizeSeriesName} from './metron-cover-index';

export const WIKIDATA_SPARQL='https://query.wikidata.org/sparql';
export const WIKIDATA_USER_AGENT='ComicHuddle-character-import/1.0 (comic catalog first-appearance facts; batch, a few queries per run)';
const SELECT='SELECT ?char ?charL ?t ?tL ?ser ?serL ?ord ?num ?gcd ?date ?qnum ?qdate WHERE {';
const TAIL=` OPTIONAL{?st pq:P433 ?qnum} OPTIONAL{?st pq:P577 ?qdate} OPTIONAL{?t wdt:P11308 ?gcd} OPTIONAL{?t wdt:P433 ?num} OPTIONAL{?t wdt:P577 ?date}
 OPTIONAL{?t p:P179 ?ss . ?ss ps:P179 ?ser . OPTIONAL{?ss pq:P1545 ?ord} OPTIONAL{?ser rdfs:label ?serL FILTER(LANG(?serL)="en")}}
 OPTIONAL{?char rdfs:label ?charL FILTER(LANG(?charL)="en")} OPTIONAL{?t rdfs:label ?tL FILTER(LANG(?tL)="en")} }`;
const FA='?char p:P4584 ?st . ?st ps:P4584 ?t .';
/** Narrow queries (one broad query times out): issue items, items with a GCD issue id, issues of comic series, issue-number qualifiers, comic classes. */
export const WIKIDATA_FIRST_APPEARANCE_QUERIES:Record<string,string>={
 comicIssues:`${SELECT} ?t wdt:P31 wd:Q140727568 . ${FA}${TAIL}`,
 gcdIssues:`${SELECT} ?t wdt:P11308 ?g0 . ${FA}${TAIL}`,
 seriesIssues:`${SELECT} ?t wdt:P179 ?s0 . ?s0 wdt:P31 wd:Q14406742 . ${FA}${TAIL}`,
 issueQualifier:`${SELECT} ${FA} ?st pq:P433 ?q0 .${TAIL}`,
 comicClasses:`${SELECT} VALUES ?c0 {wd:Q14406742 wd:Q1004 wd:Q1760610 wd:Q2342463 wd:Q80797877 wd:Q74413080 wd:Q76874795} ?t wdt:P31 ?c0 . ${FA}${TAIL}`,
};
export function wikidataCharacterInfoQuery(qids:readonly string[]){
 const values=qids.filter(q=>/^Q[1-9][0-9]{0,9}$/.test(q)).map(q=>'wd:'+q).join(' ');
 return `SELECT ?c ?links (GROUP_CONCAT(DISTINCT ?alias;separator="\\u001f") AS ?aliases) (SAMPLE(?d) AS ?desc) WHERE { VALUES ?c {${values}}
 OPTIONAL{?c wikibase:sitelinks ?links} OPTIONAL{?c skos:altLabel ?alias FILTER(LANG(?alias)="en")} OPTIONAL{?c schema:description ?d FILTER(LANG(?d)="en")} } GROUP BY ?c ?links`;
}

/** Items that are fictional characters (Q95074) or fictional organizations/groups (teams), not concepts like "mutant". */
export function wikidataFictionalQuery(qids:readonly string[]){
 const values=qids.filter(q=>/^Q[1-9][0-9]{0,9}$/.test(q)).map(q=>'wd:'+q).join(' ');
 return `SELECT ?c (SAMPLE(?k) AS ?kind) WHERE { VALUES ?c {${values}} ?c wdt:P31/wdt:P279* ?k . VALUES ?k {wd:Q95074 wd:Q14623646 wd:Q15773317 wd:Q17155908} } GROUP BY ?c`;
}

type Binding=Record<string,{value:string}|undefined>;
export type SparqlRow={char:string;charL:string|null;t:string;tL:string|null;serL:string|null;ord:string|null;num:string|null;gcd:string|null;date:string|null;qnum:string|null;qdate:string|null};
const qid=(uri:string|undefined)=>{const m=/\/entity\/(Q[1-9][0-9]{0,9})$/.exec(uri||'');return m?m[1]:null};
export function parseSparqlJson(body:unknown):SparqlRow[]{
 const bindings=(body as {results?:{bindings?:Binding[]}})?.results?.bindings;if(!Array.isArray(bindings))throw new Error('Wikidata: unexpected SPARQL payload');
 const v=(b:Binding,k:string)=>{const s=b[k]?.value?.trim();return s?s.slice(0,400):null};
 return bindings.flatMap(b=>{const char=qid(b.char?.value),t=qid(b.t?.value);return char&&t?[{char,charL:v(b,'charL'),t,tL:v(b,'tL'),serL:v(b,'serL'),ord:v(b,'ord'),num:v(b,'num'),gcd:v(b,'gcd'),date:v(b,'date'),qnum:v(b,'qnum'),qdate:v(b,'qdate')}]:[]});
}
const NUMBER=/#\s*([0-9]+(?:\.[0-9]+)?[A-Za-z]?|½)\b/;
/** "Amazing Fantasy #15" -> {series:'Amazing Fantasy',number:'15'} */
export function splitIssueLabel(label:string|null):{series:string;number:string}|null{
 if(!label)return null;const m=NUMBER.exec(label);if(!m)return null;
 const series=label.slice(0,m.index).replace(/[\s,:;(–-]+$/,'').trim();return series?{series,number:m[1]}:null;
}
const year=(d:string|null)=>{const m=/^\+?(\d{4})-/.exec(d||'');return m?Number(m[1]):null};
export type WikidataFact={qid:string;name:string;issueQid:string;issueLabel:string|null;series:string[];number:string|null;years:number[];gcdIssueId:number|null};
/** One fact per character: a GCD-linked issue first, then one with series + number, earliest year. */
export function groupFacts(rows:SparqlRow[]):WikidataFact[]{
 const byPair=new Map<string,WikidataFact>();
 for(const r of rows){
  if(!r.charL||/^Q\d+$/.test(r.charL))continue;
  const key=r.char+'|'+r.t;let f=byPair.get(key);
  if(!f){f={qid:r.char,name:r.charL,issueQid:r.t,issueLabel:r.tL,series:[],number:null,years:[],gcdIssueId:null};byPair.set(key,f)}
  const label=splitIssueLabel(r.tL);
  // A number qualifier on the statement means the target is the series itself.
  const series=r.qnum?[r.tL]:[r.serL,label?.series];
  for(const s of series)if(s&&!f.series.includes(s))f.series.push(s);
  f.number??=r.qnum||r.num||r.ord||label?.number||null;
  for(const y of [year(r.date),year(r.qdate)])if(y&&y>1800&&y<2200&&!f.years.includes(y))f.years.push(y);
  const g=r.gcd&&/^[1-9][0-9]{0,9}$/.test(r.gcd)?Number(r.gcd):null;if(g&&!f.gcdIssueId)f.gcdIssueId=g;
 }
 const best=new Map<string,WikidataFact>();
 const score=(f:WikidataFact)=>(f.gcdIssueId?0:f.series.length&&f.number?1:2)*10000+(f.years.length?Math.min(...f.years)-1800:9999);
 for(const f of byPair.values()){if(!f.gcdIssueId&&!(f.series.length&&f.number))continue;const prev=best.get(f.qid);if(!prev||score(f)<score(prev))best.set(f.qid,f)}
 for(const f of best.values())f.years.sort((a,b)=>a-b);
 return [...best.values()].sort((a,b)=>a.qid.localeCompare(b.qid));
}

// ---------- pure matcher ----------
export type GcdSeries={id:number;name:string;yearBegan:number|null;issueCount:number};
export type GcdIssue={id:number;seriesId:number;number:string|null;year:number|null};
export type MetronIndexEntry={metronId:number;series:string|null;number:string|null;coverYear:number|null};
export type FactMatch={issueId:number|null;method:string;metronId?:number|null};
const baseNumber=(n:string|null)=>normalizeIssueNumber(String(n||'').replace(/\[[^\]]*\]/g,''));
/** Series name (any of the fact's labels) + number + cover year in {year, year+1}; unique, or one clearly dominant series. */
export function matchFactByName(fact:WikidataFact,seriesByName:Map<string,GcdSeries[]>,issuesBySeries:Map<number,GcdIssue[]>):FactMatch{
 const number=normalizeIssueNumber(fact.number);if(!number)return {issueId:null,method:'no_number'};
 const series=[...new Map(fact.series.flatMap(s=>seriesByName.get(normalizeSeriesName(s))||[]).map(s=>[s.id,s])).values()];
 const pool=series.flatMap(s=>(issuesBySeries.get(s.id)||[]).filter(i=>baseNumber(i.number)===number).map(i=>({issue:i,series:s})));
 if(!pool.length)return {issueId:null,method:'unmatched'};
 const pick=(cands:typeof pool,method:string):FactMatch|null=>{
  const bySeries=new Map<number,typeof pool>();for(const c of cands){const l=bySeries.get(c.series.id);if(l)l.push(c);else bySeries.set(c.series.id,[c])}
  if(!bySeries.size)return null;
  // Within one series, a plain number beats "[Cover B]" style duplicates.
  const primary=(l:typeof pool)=>[...l].sort((a,b)=>(normalizeIssueNumber(a.issue.number)===number?0:1)-(normalizeIssueNumber(b.issue.number)===number?0:1)||(/\[(cover a|direct)/i.test(a.issue.number||'')?0:1)-(/\[(cover a|direct)/i.test(b.issue.number||'')?0:1)||a.issue.id-b.issue.id)[0];
  if(bySeries.size===1){const only=[...bySeries.values()][0];const plain=only.filter(c=>normalizeIssueNumber(c.issue.number)===number);if(plain.length>1)return {issueId:null,method:'ambiguous'};return {issueId:4000000000+primary(only).issue.id,method}}
  const ranked=[...bySeries.values()].sort((a,b)=>b[0].series.issueCount-a[0].series.issueCount);
  if(ranked[0][0].series.issueCount>=2*Math.max(1,ranked[1][0].series.issueCount))return {issueId:4000000000+primary(ranked[0]).issue.id,method:method+'_dominant'};
  return {issueId:null,method:'ambiguous'};
 };
 if(fact.years.length){
  const exact=pool.filter(c=>c.issue.year!==null&&fact.years.includes(c.issue.year));
  const near=pool.filter(c=>c.issue.year!==null&&fact.years.some(y=>c.issue.year===y+1));
  return pick(exact,'name_year')||pick(near,'name_year1')||{issueId:null,method:'unmatched_year'};
 }
 return pick(pool,'name_only')||{issueId:null,method:'ambiguous'};
}
/** Through Metron's harvested issues: series + number + cover year, unique Metron issue. */
export function matchFactViaMetron(fact:WikidataFact,index:Map<string,MetronIndexEntry[]>):number|null{
 const number=normalizeIssueNumber(fact.number);if(!number)return null;
 const cands=fact.series.flatMap(s=>index.get(normalizeSeriesName(s)+'|'+number)||[]).filter(e=>!fact.years.length||(e.coverYear!==null&&fact.years.some(y=>e.coverYear===y||e.coverYear===y+1)));
 const ids=new Set(cands.map(c=>c.metronId));return ids.size===1?[...ids][0]:null;
}
