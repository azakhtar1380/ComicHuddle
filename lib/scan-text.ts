import type {Issue} from './catalog';
import {parseCatalogSearchPage} from './catalog-picker-client';
export type CoverTextLine={text:string;confidence:number;height:number};
export type CoverTextHints={text:string;number:string|null;numberEvidence:'explicit'|'corner'|'standalone'|'none';year:number|null;queries:string[];titleWords:string[]};
const generic=new Set('a an the and of in on at by to is it this that with for from marvel dc image comics comic presents issue number no cover scan point discover upload camera start next find frame here confidential confident match yet'.split(' '));
const words=(s:string)=>s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
function useful(s:string){return words(s).filter(word=>word.length>2&&!generic.has(word)&&!/^\d+$/.test(word))}
export function extractCoverTextHints(text:string,lines:CoverTextLine[]=[]):CoverTextHints{
 const clean=text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').slice(0,12000);
 const explicit=clean.match(/#\s*(\d{1,5}(?:\.\d{1,2})?)\b/)||clean.match(/\b(?:issue|no\.?|number)\s*(\d{1,5})\b/i);
 const standalone=clean.split(/\n/).map(s=>s.trim()).find(s=>/^\d{1,3}$/.test(s));
 const corner=clean.match(/(?:\d{2,3}\s*[¢cC]|\$\s*\d\.\d{2})\s+(\d{1,3})\b/)||clean.match(/\b(\d{1,3})\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i);
 const number=explicit?.[1]||corner?.[1]||standalone||null;
 const yearMatch=clean.match(/\b(19[3-9]\d|20[0-3]\d)\b/),year=yearMatch?Number(yearMatch[1]):null;
 const ranked=(lines.length?lines:clean.split(/\n/).map(text=>({text,confidence:50,height:1})))
  .filter(line=>line.confidence>=25&&useful(line.text).length>=1&&words(line.text).length<=12)
  .sort((a,b)=>b.height-a.height||b.confidence-a.confidence).slice(0,6);
 const phrases=[...new Set(ranked.map(line=>useful(line.text).join(' ')).filter(s=>s.length>=4&&s.length<=70))];
 const combined=phrases.slice(0,2).join(' '),selected=[...phrases.slice(0,3),combined].filter(Boolean);
 const queries=[...new Set(selected.map(phrase=>(phrase+(number?' #'+number:'')).slice(0,150)))].slice(0,4);
 return {text:clean,number,numberEvidence:explicit?'explicit':corner?'corner':standalone?'standalone':'none',year,queries,titleWords:[...new Set(phrases.slice(0,3).flatMap(words))]};
}
function tokenMatch(a:string,b:string){
 if(a===b)return true;
 // A single OCR substitution is tolerated for longer title words.
 if(a.length<5||a.length!==b.length)return false;let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;return changed<=1;
}
export function rankTextIssues(hints:CoverTextHints,issues:Issue[]){
 return issues.map(issue=>{
  const title=useful(issue.title),observed=hints.titleWords,matched=title.filter(token=>observed.some(word=>tokenMatch(token,word))).length;
  const coverage=matched/Math.max(1,title.length),precision=matched/Math.max(1,observed.length);
  const numberMatch=!!hints.number&&issue.number.toLowerCase()===hints.number.toLowerCase(),yearMatch=!!hints.year&&issue.year===hints.year;
  const score=.50*coverage+.22*precision+(numberMatch ? .20 : 0)+(yearMatch ? .08 : 0);
  return {issue,score,matched,numberMatch};
 }).filter(row=>row.matched>=Math.min(2,useful(row.issue.title).length)&&(!hints.number||row.numberMatch)).sort((a,b)=>b.score-a.score||a.issue.id-b.issue.id);
}
export async function lookupCoverText(hints:CoverTextHints,fetcher:typeof fetch=fetch,signal?:AbortSignal){
 if(!hints.queries.length)return {candidates:[] as Issue[],match:null as Issue|null,searchText:'',empty:false};
 const results=await Promise.allSettled(hints.queries.map(async q=>{
  const response=await fetcher('/api/catalog?'+new URLSearchParams({q,limit:'12',offset:'0'}),{signal,cache:'no-store'});
  if(!response.ok)throw Error('The catalog text search could not connect.');return parseCatalogSearchPage(await response.json());
 }));
 if(signal?.aborted)throw new DOMException('Cover search cancelled.','AbortError');
 const pages=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
 if(!pages.length)throw Error('The catalog text search could not connect.');
 const unique=new Map(pages.flatMap(page=>page.issues).map(issue=>[issue.id,issue])),ranked=rankTextIssues(hints,[...unique.values()]);
 const first=ranked[0],other=ranked.find(row=>row.issue.title!==first?.issue.title||row.issue.year!==first?.issue.year);
 // Text can identify a work while leaving several physical editions possible.
 // Never auto-select a printing, or treat a loose price/barcode digit as proof.
 const sameWork=first?ranked.filter(row=>row.issue.title===first.issue.title&&row.issue.year===first.issue.year):[];
 const complete=pages.length===hints.queries.length&&pages.every(page=>!page.hasMore);
 const strongNumber=hints.numberEvidence==='explicit'||hints.numberEvidence==='corner';
 const match=complete&&sameWork.length===1&&first&&strongNumber&&first.score>=.76&&first.score-(other?.score||0)>=.10?first.issue:null;
 return {candidates:ranked.slice(0,8).map(row=>row.issue),match,searchText:hints.queries[0],empty:pages.length===hints.queries.length&&pages.every(page=>page.total===0&&!page.hasMore)};
}
