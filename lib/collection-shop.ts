// "Your comic shop" data: the owner's shop page extras, and the public Collection tab that follows the
// Shop window setting (open | window | closed). The public view never carries value, purchase price, notes,
// cert numbers or the member's own photos; covers come from the Directory (cover policy) or placeholders.
import {getPool} from '../db/postgres';
import type {CatalogDb} from './catalog-store';
import {catalogIssuesById} from './catalog-store';
import {issueKeys} from './issue-keys';
import {listRuns,missingIssueIds,type CollectionRun} from './collection-runs';
import {addedDates,copyDirectoryId,isGraded} from './vault-ledger';
import type {Vault} from './vault';

export type ShopWindow='open'|'window'|'closed';
export const SHOP_WINDOWS:readonly ShopWindow[]=['open','window','closed'];
export const isShopWindow=(v:unknown):v is ShopWindow=>typeof v==='string'&&(SHOP_WINDOWS as readonly string[]).includes(v);
export async function shopWindowOf(profileId:string):Promise<ShopWindow>{
 try{const v=(await getPool().query<{shop_window:string}>('SELECT shop_window FROM ch_web.profile_extras WHERE profile_id=$1',[profileId])).rows[0]?.shop_window;return isShopWindow(v)?v:'window'}catch{return 'window'}
}
export type PublicCopy={id:string;title:string;issue:string;directoryIssueId:number|null;grade:string;graded:boolean;key:{tag:'KEY'|'1ST';note:string}|null;
 publisher:string;year:number|null;era:string;creators:string[];characters:string[];cover:string|null;coverCredit:string|null;openToTrade:boolean};
export type PublicCollection={window:ShopWindow;glass:PublicCopy[];runs:CollectionRun[];comics:PublicCopy[];counts:{comics:number;graded:number;keys:number}};

const gradeLabel=(book:Vault['books'][number])=>{const o=book.ownership;if(o?.format==='GRADED')return o.grade?'CGC '+o.grade:'Graded';const cgc=/^CGC\s*(\d{1,2}(?:\.\d)?)/i.exec(book.grade);return cgc?'CGC '+cgc[1]:'RAW'};
const rawCondition=(book:Vault['books'][number])=>book.ownership?.rawCondition?book.ownership.rawCondition.toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):null;
/** Public, value-free description of every copy (used for the glass case and the open shop). */
export async function publicCopies(db:CatalogDb,vault:Vault):Promise<PublicCopy[]>{
 const ids=[...new Set(vault.books.map(copyDirectoryId).filter((id):id is number=>id!==null))];
 const [records,keys]=await Promise.all([(async()=>{const out=new Map<number,Awaited<ReturnType<typeof catalogIssuesById>>[number]>();for(let i=0;i<ids.length;i+=200)for(const issue of await catalogIssuesById(db,ids.slice(i,i+200)).catch(()=>[]))out.set(issue.id,issue);return out})(),issueKeys(db,ids).catch(()=>new Map())]);
 const trade=new Set(vault.tradeBookIds);
 return vault.books.map(book=>{
  const id=copyDirectoryId(book),r=id===null?undefined:records.get(id),k=id===null?undefined:keys.get(id),graded=isGraded(book);
  const grade=graded?gradeLabel(book):(rawCondition(book)?'Raw · '+rawCondition(book):'RAW');
  return {id:book.id,title:r?.title||book.title,issue:r?'#'+r.number.replace(/^#/,''):book.issue,directoryIssueId:id,grade,graded,
   key:k?{tag:/^1st /.test(k.note)?'1ST' as const:'KEY' as const,note:k.note}:null,publisher:r?.publisher||'',year:r?.year||null,era:r?.era||'',
   creators:[r?.writer,r?.artist].filter((v):v is string=>!!v).flatMap(v=>v.split(/;|,/)).map(v=>v.trim()).filter(Boolean).slice(0,4),characters:(r?.characters||[]).slice(0,6),
   cover:r?.cover||null,coverCredit:r?.coverCredit||null,openToTrade:trade.has(book.id)};
 });
}
export async function publicCollection(db:CatalogDb,profile:{id:string;userId:string},vault:Vault,window?:ShopWindow):Promise<PublicCollection>{
 const shop=window||await shopWindowOf(profile.id);
 if(shop==='closed')return {window:'closed',glass:[],runs:[],comics:[],counts:{comics:0,graded:0,keys:0}};
 const [copies,listed]=await Promise.all([publicCopies(db,vault),listRuns(db,profile.userId,vault)]);
 // Visitors can add a run's missing issues to their own wishlist.
 const runs=await Promise.all(listed.map(async run=>({...run,missingIds:run.missing.length?(await missingIssueIds(db,profile.userId,run.id,vault)).slice(0,200):[]})));
 const glass=copies.filter(c=>c.graded||c.key);
 return {window:shop,glass:glass.slice(0,120),runs,comics:shop==='open'?copies.slice(0,1000):[],counts:{comics:copies.length,graded:copies.filter(c=>c.graded).length,keys:copies.filter(c=>c.key).length}};
}
/** Owner's shop page extras: key notes per Directory issue, date each copy was stocked, runs, shop window. */
export async function ownerShop(db:CatalogDb,profile:{id:string;userId:string},vault:Vault){
 const ids=[...new Set(vault.books.map(copyDirectoryId).filter((id):id is number=>id!==null))];
 const [keys,added,runs,window]=await Promise.all([issueKeys(db,ids).catch(()=>new Map()),addedDates(profile.userId,vault),listRuns(db,profile.userId,vault),shopWindowOf(profile.id)]);
 return {keys:Object.fromEntries([...keys].map(([id,k])=>[id,{note:k.note,reasons:k.reasons.slice(0,4)}])),added,runs,window};
}
