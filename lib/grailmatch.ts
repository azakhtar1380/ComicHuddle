import type {CollectorProfile,ShowcaseBook} from './community';
import type {Vault} from './vault';
import {bookIssue} from './trades';
export type SwipeCard={pair:string;person:CollectorProfile;give:ShowcaseBook;get:ShowcaseBook};
export function tradePair(a:string,give:string,b:string,get:string){return [a+':'+give,b+':'+get].sort().join('|')}
export function swipeCards(me:CollectorProfile,vault:Vault,people:CollectorProfile[],seen:{pair:string;direction:string}[]):SwipeCard[]{
 if(!me.visible||!me.dmOpen)return [];
 const cards:SwipeCard[]=[];const done=new Set(seen.map(s=>s.pair));
 for(const p of people){if(p.id===me.id||!p.dmOpen||!p.visible||p.example)continue;
 for(const give of vault.books.filter(b=>vault.tradeBookIds.includes(b.id))){const g=bookIssue(give);if(!g||!p.wantIds.includes(g.id))continue;
 for(const get of p.tradeBooks){const w=bookIssue(get);if(!w||g.id===w.id||!vault.wants.includes(w.id))continue;
 const pair=tradePair(me.id,give.id,p.id,get.id);if(!done.has(pair)){cards.push({pair,person:p,give,get});done.add(pair)}}}}
 return cards;
}
