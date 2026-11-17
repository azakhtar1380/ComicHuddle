// The profile's Collection tab (the only collection page). Owners see every copy plus key notes and an estimate
// they can reveal; visitors see a read-only grid following "Show my collection": Everyone / Keys only / Only me.
// The setting reuses profile_extras.shop_window (open → everyone, window → keys, closed → me). The public view
// never carries value, purchase price, notes, cert numbers or the member's own photos.
import {getPool} from '../db/postgres';
import type {CatalogDb} from './catalog-store';
import {catalogIssuesById} from './catalog-store';
import {issueKeys} from './issue-keys';
import {copyDirectoryId,isGraded} from './vault-ledger';
import type {Vault} from './vault';

export type CollectionVisibility='everyone'|'keys'|'me';
export const VISIBILITY_TO_COLUMN:Record<CollectionVisibility,'open'|'window'|'closed'>={everyone:'open',keys:'window',me:'closed'};
export const columnToVisibility=(v:unknown):CollectionVisibility=>v==='open'?'everyone':v==='closed'?'me':'keys';
export async function visibilityOf(profileId:string):Promise<CollectionVisibility>{
 try{return columnToVisibility((await getPool().query<{shop_window:string}>('SELECT shop_window FROM ch_web.profile_extras WHERE profile_id=$1',[profileId])).rows[0]?.shop_window)}catch{return 'keys'}
}
export type CollectionCopy={id:string;title:string;issue:string;directoryIssueId:number|null;year:number|null;grade:string;graded:boolean;keyNote:string|null;cover:string|null;forTrade:boolean};
const rawLabel=(book:Vault['books'][number])=>book.ownership?.rawCondition?book.ownership.rawCondition.toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):null;
const gradeOf=(book:Vault['books'][number])=>{
 if(isGraded(book)){const o=book.ownership;if(o?.format==='GRADED')return o.grade?'CGC '+o.grade:'Graded';const cgc=/^CGC\s*(\d{1,2}(?:\.\d)?)/i.exec(book.grade);return cgc?'CGC '+cgc[1]:'Graded'}
 return rawLabel(book)||(/^raw\b/i.test(book.grade)||!book.grade.trim()?'Raw':book.grade.trim().slice(0,24));
};
/** Value-free description of each copy, with Directory key notes and covers (cover policy applies upstream). */
export async function collectionCopies(db:CatalogDb,vault:Vault):Promise<CollectionCopy[]>{
 const ids=[...new Set(vault.books.map(copyDirectoryId).filter((id):id is number=>id!==null))];
 const records=new Map<number,Awaited<ReturnType<typeof catalogIssuesById>>[number]>();
 for(let i=0;i<ids.length;i+=200)for(const issue of await catalogIssuesById(db,ids.slice(i,i+200)).catch(()=>[]))records.set(issue.id,issue);
 const keys=await issueKeys(db,ids).catch(()=>new Map());
 const trade=new Set(vault.tradeBookIds);
 return vault.books.map(book=>{const id=copyDirectoryId(book),r=id===null?undefined:records.get(id);
  return {id:book.id,title:r?.title||book.title,issue:r?'#'+r.number.replace(/^#/,''):book.issue,directoryIssueId:id,year:r?.year||null,grade:gradeOf(book),graded:isGraded(book),keyNote:id===null?null:keys.get(id)?.note||null,cover:r?.cover||null,forTrade:trade.has(book.id)}});
}
/** Sum of existing Directory estimates (low–high) for the owner's copies; never invented. */
export async function collectionEstimate(db:CatalogDb,vault:Vault){
 const ids=vault.books.map(copyDirectoryId).filter((id):id is number=>id!==null);
 const records=new Map<number,{estimatedValue?:{lowCents:number|null;highCents:number|null}}>();
 const unique=[...new Set(ids)];for(let i=0;i<unique.length;i+=200)for(const issue of await catalogIssuesById(db,unique.slice(i,i+200)).catch(()=>[]))records.set(issue.id,issue);
 let low=0,high=0,priced=0;for(const id of ids){const e=records.get(id)?.estimatedValue;if(e&&e.lowCents!=null&&e.highCents!=null){low+=e.lowCents;high+=e.highCents;priced++}}
 return {lowCents:low,highCents:high,priced,total:vault.books.length};
}
export type PublicCollectionView={visibility:CollectionVisibility;copies:CollectionCopy[];total:number};
export async function publicCollectionView(db:CatalogDb,profileId:string,vault:Vault):Promise<PublicCollectionView>{
 const visibility=await visibilityOf(profileId);
 if(visibility==='me')return {visibility,copies:[],total:0};
 const copies=await collectionCopies(db,vault);
 const shown=visibility==='keys'?copies.filter(c=>c.keyNote):copies;
 return {visibility,copies:shown.slice(0,1000),total:shown.length};
}
