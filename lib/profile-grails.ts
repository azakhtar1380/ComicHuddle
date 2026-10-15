import {catalog,type Issue} from './catalog';
import type {Vault} from './vault';
import {listingDirectoryId,issueIdentity,sharedProviderIdentity} from './shared-catalog';
import {publicOwnedCopy} from './collection-entry';
import type {ShowcaseBook} from './community';

export const directoryGrail=(id:number)=>'directory:'+id;
export function directoryGrailId(value:string):number|null{
 if(!/^directory:\d{1,10}$/.test(value))return null;const id=Number(value.slice(10));
 return Number.isSafeInteger(id)&&(!!catalog[id]||sharedProviderIdentity(id)!==null)?id:null;
}
export function featuredIssueId(value:string,books:Vault['books']){
 const copy=books.find(book=>book.id===value);return copy?listingDirectoryId(copy):directoryGrailId(value);
}
/** Directory favorites never imply ownership and never mutate the private vault. */
export function profileGrails(books:Vault['books'],featured:string[],directory:Map<number,Issue>):ShowcaseBook[]{
 return featured.slice(0,6).flatMap(key=>{
  const copy=books.find(book=>book.id===key),id=featuredIssueId(key,books),record=id===null?undefined:directory.get(id)||catalog[id];
  if(copy)return [{...publicOwnedCopy(copy),...(id===null?{}:{directoryIssueId:id}),...(record?.cover?{cover:record.cover,coverCredit:record.coverCredit}:{})}];
  if(!record)return [];
  return [{id:key,title:record.title,issue:'#'+record.number,grade:'Directory favorite · ownership not recorded',directoryIssueId:record.id,...issueIdentity(record),...(record.cover?{cover:record.cover,coverCredit:record.coverCredit}:{})}];
 });
}
