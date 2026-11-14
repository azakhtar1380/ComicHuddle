import {getDb} from '../db';
import type {Issue} from './catalog';
import {catalogSearchDto} from './catalog-search';
import {searchSharedCatalog} from './catalog-store';
import {lookupComicIdentifier} from './catalog-identifiers';
import {buildCatalogQueries,rankCatalogCandidates} from './cover-ocr';
import type {CoverIdentification} from './cover-vision';
/** AI identification -> barcode digits (if read) + catalog title/issue search -> ranked candidates to confirm. */
type Search=(q:string)=>Promise<Issue[]>;
const sharedSearch:Search=async q=>(await searchSharedCatalog(getDb(),{q,limit:12,offset:0})).issues as Issue[];
export async function catalogCandidatesFor(identification:CoverIdentification,search:Search=sharedSearch){
 const hints={titles:identification.title?[identification.title]:[],number:identification.issue_number.replace(/^#/,'').trim()||null,year:identification.year,publisher:identification.publisher||null};
 const found:Issue[]=[];
 if(identification.barcode_digits){try{const byCode=await lookupComicIdentifier(identification.barcode_digits.replace(/\D/g,''));if(byCode?.issues.length)found.push(...byCode.issues)}catch{}}
 for(const q of buildCatalogQueries(hints).slice(0,3)){try{found.push(...await search(q))}catch{}}
 return rankCatalogCandidates(hints,found).slice(0,8).map(row=>({issue:catalogSearchDto(row.issue),score:Number(row.score.toFixed(3)),numberMatch:row.numberMatch}));
}

