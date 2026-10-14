import type {Issue,GcdBibliography,GcdStory} from './catalog';

export type CatalogSearchPage={issues:Issue[];total:number;limit:number;offset:number;hasMore:boolean;issueCount:number;scope:string};
const textFields=['title','number','publisher','era','writer','artist','note','kind','variant','source'] as const;
const optionalFields=['cover','coverArtist','coverCredit','coverSource','dataCredit','dataLicense'] as const;
export function parseGcdBibliography(input:unknown):GcdBibliography{
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>240000)throw new Error('Invalid GCD bibliography.');
 const b=input as Record<string,unknown>;
 const fields=['publicationDate','keyDate','onSaleDate','pageCount','isbn','barcode','issueTitle','volume','indiciaPublisher','brandEmblem','rating','indiciaFrequency','indiciaPrinter','keywords','editing'];
 const text=(v:unknown,max=6000)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(v)&&!/<[^>]*>/.test(v);
 if(fields.some(k=>!text(b[k],k==='issueTitle'||k==='keywords'||k==='editing'?2000:500))||!Number.isInteger(b.seriesProviderId)||Number(b.seriesProviderId)<1||Number(b.seriesProviderId)>2147483647||!(b.variantOf===null||Number.isInteger(b.variantOf)&&Number(b.variantOf)>0&&Number(b.variantOf)<=2147483647)||!Array.isArray(b.stories)||b.stories.length>100)throw new Error('Invalid GCD bibliography fields.');
 const price=b.originalCoverPrice as Record<string,unknown>|null;
 if(!price||typeof price!=='object'||price.kind!=='ORIGINAL_COVER_PRICE'||!text(price.text,400))throw new Error('Invalid original cover price.');
 const storyFields=['type','title','feature','pageCount','script','pencils','inks','colors','letters','editing','jobNumber','genre','firstLine','characters','synopsis','notes','keywords'];
 const stories=b.stories.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid GCD story.');const story=value as Record<string,unknown>;if(storyFields.some(k=>!text(story[k]))||!(story.sequenceNumber===null||typeof story.sequenceNumber==='number'&&Number.isFinite(story.sequenceNumber)))throw new Error('Invalid GCD story fields.');return Object.fromEntries([...storyFields.map(k=>[k,story[k]]),['sequenceNumber',story.sequenceNumber]]) as GcdStory;});
 return {...Object.fromEntries(fields.map(k=>[k,b[k]])),originalCoverPrice:{kind:'ORIGINAL_COVER_PRICE',text:price.text as string},seriesProviderId:Number(b.seriesProviderId),variantOf:b.variantOf as number|null,stories} as GcdBibliography;
}
export function parseCatalogSearchPage(input:unknown):CatalogSearchPage{
 if(!input||typeof input!=='object')throw new Error('Invalid directory response.');
 const data=input as Record<string,unknown>;
 for(const key of ['total','limit','offset','issueCount'])if(!Number.isInteger(data[key])||Number(data[key])<0)throw new Error('Invalid directory pagination.');
 if(Number(data.limit)<1||Number(data.limit)>30||!Array.isArray(data.issues)||data.issues.length>Number(data.limit)||typeof data.hasMore!=='boolean'||typeof data.scope!=='string')throw new Error('Invalid directory response.');
 const seen=new Set<number>();
 const issues:Issue[]=data.issues.map((input:unknown)=>{
  if(!input||typeof input!=='object')throw new Error('Invalid comic record.');
  const record=input as Record<string,unknown>;
  if(!Number.isInteger(record.id)||Number(record.id)<0||seen.has(Number(record.id))||!Number.isInteger(record.year)||!Array.isArray(record.characters)||record.characters.some(value=>typeof value!=='string')||textFields.some(key=>typeof record[key]!=='string'))throw new Error('Invalid comic record.');
  seen.add(Number(record.id));
  const issue={id:Number(record.id),year:Number(record.year),characters:[...record.characters]} as Issue;
  for(const key of textFields)issue[key]=record[key] as string;
  for(const key of optionalFields)if(typeof record[key]==='string')issue[key]=record[key] as string;
  if(record.metronId!==undefined){if(!Number.isInteger(record.metronId)||Number(record.metronId)<1||Number(record.metronId)>2147483647||Number(record.id)!==1000000000+Number(record.metronId))throw new Error('Invalid shared comic identity.');issue.metronId=Number(record.metronId);}
  if(record.gcdId!==undefined){if(record.metronId!==undefined||!Number.isInteger(record.gcdId)||Number(record.gcdId)<1||Number(record.gcdId)>2147483647||Number(record.id)!==4000000000+Number(record.gcdId))throw new Error('Invalid GCD comic identity.');issue.gcdId=Number(record.gcdId);}
  if(record.bibliography!==undefined){if(issue.gcdId===undefined)throw new Error('GCD bibliography requires GCD identity.');issue.bibliography=parseGcdBibliography(record.bibliography);}
  return issue;
 });
 const total=Number(data.total),offset=Number(data.offset),limit=Number(data.limit);
 if(issues.length!==Math.min(limit,Math.max(0,total-offset))||data.hasMore!==(offset+limit<total))throw new Error('Invalid directory pagination.');
 return {issues,total,limit,offset,hasMore:data.hasMore,issueCount:Number(data.issueCount),scope:data.scope};
}

// Aborting a fetch alone is insufficient: a late response may still resolve.
// The generation also discards responses and errors from superseded requests.
export function createCatalogSearchSession(fetcher:typeof fetch=fetch){
 let generation=0,controller:AbortController|null=null;
 return {
  async search(query:string,offset=0):Promise<CatalogSearchPage|null>{
   const current=++generation;controller?.abort();const request=new AbortController();controller=request;
   try{
    const params=new URLSearchParams({q:query,limit:'12',offset:String(offset)});
    const response=await fetcher('/api/catalog?'+params,{signal:request.signal,cache:'no-store'});
    if(!response.ok)throw new Error('Directory request failed.');
    const page=parseCatalogSearchPage(await response.json());
    return current===generation&&!request.signal.aborted?page:null;
   }catch(error){if(current!==generation||request.signal.aborted)return null;throw error}
   finally{if(current===generation)controller=null}
  },
  cancel(){generation++;controller?.abort();controller=null}
 };
}

export function nextPickerIndex(key:string,current:number,count:number){
 if(count<=0)return -1;
 if(key==='ArrowDown')return current<0||current>=count-1?0:current+1;
 if(key==='ArrowUp')return current<=0||current>=count?count-1:current-1;
 return current;
}
