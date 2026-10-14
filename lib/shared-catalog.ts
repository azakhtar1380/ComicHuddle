import type {Issue} from './catalog';

// Keep the existing 0–42 account references stable. Metron identity occupies a
// separate numeric range; the provider's original ID is also retained in D1.
export const METRON_DIRECTORY_OFFSET=1_000_000_000;
export const METRON_ID_MAX=2_147_483_647;
// Metron's admitted range reaches 3,147,483,647. Keep GCD entirely above it.
export const GCD_DIRECTORY_OFFSET=4_000_000_000;
export const GCD_ID_MAX=2_147_483_647;
export const gcdDirectoryId=(id:number)=>GCD_DIRECTORY_OFFSET+id;
export const metronDirectoryId=(id:number)=>METRON_DIRECTORY_OFFSET+id;
export function sharedMetronId(id:number):number|null{
 const value=id-METRON_DIRECTORY_OFFSET;
 return Number.isSafeInteger(value)&&value>=1&&value<=METRON_ID_MAX?value:null;
}
export function sharedGcdId(id:number):number|null{
 const value=id-GCD_DIRECTORY_OFFSET;
 return Number.isSafeInteger(value)&&value>=1&&value<=GCD_ID_MAX?value:null;
}
export type SharedProviderIdentity={provider:'Metron'|'GCD';id:number;sourceUrl:string;license:'CC BY-SA 4.0'};
export function sharedProviderIdentity(id:number):SharedProviderIdentity|null{
 const metron=sharedMetronId(id);if(metron!==null)return {provider:'Metron',id:metron,sourceUrl:'https://metron.cloud/issue/'+metron+'/',license:'CC BY-SA 4.0'};
 const gcd=sharedGcdId(id);return gcd===null?null:{provider:'GCD',id:gcd,sourceUrl:'https://www.comics.org/issue/'+gcd+'/',license:'CC BY-SA 4.0'};
}
export function eraForYear(year:number){return year<1956?'Golden Age':year<1970?'Silver Age':year<1985?'Bronze Age':year<1992?'Copper Age':'Modern Age'}
export function plainCatalogText(value:unknown,max=500):string{
 if(typeof value!=='string')return '';
 return value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export function catalogSearchText(issue:Issue){return [issue.title,issue.number,issue.publisher,String(issue.year),issue.writer,issue.artist,issue.coverArtist||'',issue.kind,issue.note,...issue.characters].join(' ').normalize('NFKD').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ')}
export function issueIdentity(issue:Issue){
 if(issue.metronId!==undefined&&issue.gcdId!==undefined)throw new Error('Choose one provider identity.');
 const external=sharedProviderIdentity(issue.id);
 if(external)return {externalCatalog:external};
 return {catalogId:issue.id};
}

// Public listing and owned-copy lookups use explicit directory identities.
// A manual title/issue match alone is never evidence of the same edition.
export function listingDirectoryId(item:{catalogId?:number;externalCatalog?:{provider:string;id:number}}):number|null{
 const external=item.externalCatalog;
 if(external){if(!Number.isSafeInteger(external.id)||external.id<1||external.id>METRON_ID_MAX)return null;return external.provider==='Metron'?metronDirectoryId(external.id):external.provider==='GCD'?gcdDirectoryId(external.id):null;}
 return Number.isSafeInteger(item.catalogId)&&item.catalogId!>=0&&item.catalogId!<METRON_DIRECTORY_OFFSET?item.catalogId!:null;
}
