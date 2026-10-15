import {catalog,type Issue} from './catalog';
import {normalize} from './catalog';

const catalogById=new Map(catalog.map(issue=>[issue.id,issue]));
export function linkedCatalogIssue(book:{catalogId?:number;title:string;issue:string}):Issue|undefined{
 if(book.catalogId===undefined)return undefined;
 const issue=catalogById.get(book.catalogId);
 const number=book.issue.trim().replace(/^#\s*/,'').replace(/\s/g,'').toLowerCase();
 return issue&&normalize(book.title)===normalize(issue.title)&&number===issue.number.replace(/\s/g,'').toLowerCase()?issue:undefined;
}

export type CatalogSearchIssue=Issue&{series:string;issue:string;edition:string;keyInfo:{kind:string;note:string}};
export function catalogSearchDto(issue:Issue,includeBibliography=false):CatalogSearchIssue{
 const {bibliography,...summary}=issue;
 return {...summary,...(includeBibliography&&bibliography?{bibliography}:{}),series:issue.title,issue:'#'+issue.number,edition:issue.variant,keyInfo:{kind:issue.kind,note:issue.note}};
}
function compact(value:string){return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'')}
export function searchCatalog(query:string,limit:number,offset:number){
 const issueNumbers=[...query.matchAll(/#\s*([a-z0-9./-]+)/gi)].map(match=>match[1].toLowerCase());
 const words=query.replace(/#\s*([a-z0-9./-]+)/gi,' ').normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g)||[];
 const prefix=compact(words.filter(word=>!/^[0-9]+$/.test(word)).join(''));
 const matches=catalog.filter(issue=>{
  if(issueNumbers.some(number=>number!==issue.number.toLowerCase()))return false;
  const fields=[issue.title,issue.publisher,String(issue.year),issue.kind,issue.note,issue.writer,issue.artist,...issue.characters].map(compact);
  return words.every(word=>/^[0-9]+$/.test(word)?word===issue.number||word===String(issue.year):fields.some(field=>field.includes(word)));
 }).sort((a,b)=>{
  const score=(issue:Issue)=>prefix?(compact(issue.title)===prefix?2:compact(issue.title).startsWith(prefix)?1:0):0;
  return score(b)-score(a)||a.id-b.id;
 });
 return {issues:matches.slice(offset,offset+limit).map(issue=>catalogSearchDto(issue)),total:matches.length,limit,offset,hasMore:offset+limit<matches.length};
}

/** Explicit year qualifiers avoid confusing titles such as 2000 AD or 2099. */
export function catalogQueryParts(query:string){
 const numbers=[...query.matchAll(/#\s*([a-z0-9./-]+)/gi)].map(match=>match[1].toLowerCase()),years:number[]=[];
 let text=query.replace(/\(((?:18|19|20|21)\d{2})\)/g,(_all,year)=>{years.push(Number(year));return ' '});
 if(numbers.length)text=text.replace(/\s+((?:18|19|20|21)\d{2})\s*$/,(_all,year)=>{years.push(Number(year));return ' '});
 const words=text.replace(/#\s*([a-z0-9./-]+)/gi,' ').normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g)||[];
 return {numbers,words,years:[...new Set(years)]};
}
