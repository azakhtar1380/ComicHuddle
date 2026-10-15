import type {Issue} from './catalog';
import {parseCatalogSearchPage} from './catalog-picker-client';
import {coverSignatures} from './cover-phash';
import type {PixelImage} from './cover-recognition';
export async function lookupVisualCover(image:PixelImage,options:{mode:'camera'|'upload';viewportWidth?:number;viewportHeight?:number},signal?:AbortSignal){
 const signatures=coverSignatures(image,options);if(!signatures.length)return {match:null as Issue|null,candidates:[] as Issue[]};
 const response=await fetch('/api/recognition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signatures}),signal});
 if(!response.ok)throw Error('The catalog visual index could not connect.');
 const body=await response.json() as {status?:string;candidates?:{issue:Issue}[]};
 if(!Array.isArray(body.candidates)||body.candidates.length>6)throw Error('The visual index returned unreadable candidates.');
 const candidates=body.candidates.map(row=>parseCatalogSearchPage({issues:[row.issue],total:1,limit:1,offset:0,hasMore:false,issueCount:1,scope:'shared'}).issues[0]);
 return {match:body.status==='matched'?candidates[0]||null:null,candidates};
}
