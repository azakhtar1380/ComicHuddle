import {catalog,normalize} from './catalog';
import {linkedCatalogIssue} from './catalog-search';
export type Book={id:string;title:string;issue:string;grade:string;price:number;catalogId?:number};
export type Collector={id:string;name:string;location:string;offers:number[];wants:number[]};
export type Match={id:string;type:'direct'|'loop';give:Book;get:number;participants:Collector[];bridge?:number};
export const demoCollectors:Collector[]=[
{id:'demo-a',name:'Night Owl',location:'Minneapolis, MN',offers:[0,1,6],wants:[2,3,4,10]},
{id:'demo-b',name:'Cosmic Shelf',location:'Madison, WI',offers:[0,2,3,10,12],wants:[0,1,5,15]},
{id:'demo-c',name:'Ink & Issues',location:'Chicago, IL',offers:[4,5,13,15],wants:[2,3,6,10]},
{id:'demo-d',name:'Sunday Longbox',location:'St. Paul, MN',offers:[7,8,9,11],wants:[4,5,12,13]}
];
export function bookIssue(b:Pick<Book,'title'|'issue'|'catalogId'>){if(b.catalogId!==undefined)return linkedCatalogIssue(b);const matches=catalog.filter(c=>normalize(c.title)===normalize(b.title)&&normalize(c.number)===normalize(b.issue.split(' · ')[0]));return matches.length===1?matches[0]:undefined;}
export function findMatches(books:Book[],wants:number[],offeredIds:string[],collectors:Collector[]=demoCollectors):Match[]{
const offered=books.filter(b=>offeredIds.includes(b.id));const out:Match[]=[];const seen=new Set<string>();
for(const give of offered){const issue=bookIssue(give);if(!issue)continue;for(const get of wants){if(get===issue.id)continue;for(const a of collectors){if(!a.wants.includes(issue.id))continue;if(a.offers.includes(get)){const id=`direct:${give.id}:${get}:${a.id}`;if(!seen.has(id)){seen.add(id);out.push({id,type:'direct',give,get,participants:[a]});}}
for(const bridge of a.offers){if(bridge===get||bridge===issue.id)continue;for(const b of collectors){if(b.id===a.id||!b.wants.includes(bridge)||!b.offers.includes(get))continue;const id=`loop:${give.id}:${get}:${a.id}:${b.id}:${bridge}`;if(!seen.has(id)){seen.add(id);out.push({id,type:'loop',give,get,bridge,participants:[a,b]});}}}}}}
return out.sort((a,b)=>Number(a.type==='loop')-Number(b.type==='loop'));
}
