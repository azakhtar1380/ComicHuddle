import type {Issue} from './catalog';
import {parseCatalogSearchPage} from './catalog-picker-client';

// This is a finite on-device reference matcher, not a general comic classifier.
// Scores measure feature distance; they are not calibrated probabilities.
export type RecognitionStatus='idle'|'starting'|'scanning'|'checking_directory'|'matched'|'unknown'|'not_in_directory'|'index_unavailable'|'permission_denied';
export type PixelImage={width:number;height:number;data:ArrayLike<number>};
export type CoverCrop={x:number;y:number;width:number;height:number};
export type CoverDescriptor={luma:number[];chroma:number[];edges:number[];contrast:number};
export type CoverReference={catalogId:number;title:string;number:string;publisher:string;year:number;cover:string;sourceUrl:string;credit:string;sha256:string;descriptor:CoverDescriptor};
export type CoverIndex={version:1;width:18;height:26;maxDistance:number;minMargin:number;references:CoverReference[]};
export type CoverSuggestion={reference:CoverReference;distance:number;margin:number;crop:CoverCrop};
export type CoverRecognition={status:'matched';suggestion:CoverSuggestion}|{status:'unknown'|'index_unavailable'};
export type ScanDirectoryResult={status:'matched';issue:Issue}|{status:'not_in_directory'|'unknown'|'index_unavailable'};
export type ExactComicText={title:string;number:string;year?:number};
export const COVER_FEATURE_WIDTH=18,COVER_FEATURE_HEIGHT=26,COVER_FRAME_INTERVAL_MS=450;
const featureCount=COVER_FEATURE_WIDTH*COVER_FEATURE_HEIGHT;
const cleanIdentity=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

export function describeCoverThumbnail(rgb:ArrayLike<number>):CoverDescriptor{
 if(rgb.length!==featureCount*3)throw Error('Invalid cover thumbnail.');
 const luma:number[]=[],chroma:number[]=[];
 for(let i=0;i<rgb.length;i+=3){
  const r=rgb[i],g=rgb[i+1],b=rgb[i+2];
  if(![r,g,b].every(value=>finite(value)&&value>=0&&value<=255))throw Error('Invalid cover pixels.');
  luma.push((.2126*r+.7152*g+.0722*b)/255);
  const total=Math.max(40,r+g+b);chroma.push(r/total,g/total);
 }
 const mean=luma.reduce((sum,value)=>sum+value,0)/featureCount;
 const contrast=Math.sqrt(luma.reduce((sum,value)=>sum+(value-mean)**2,0)/featureCount);
 const normalized=luma.map(value=>(value-mean)/Math.max(.04,contrast)),edges:number[]=[];
 for(let y=0;y<COVER_FEATURE_HEIGHT;y++)for(let x=0;x<COVER_FEATURE_WIDTH;x++){
  const i=y*COVER_FEATURE_WIDTH+x;
  if(x<COVER_FEATURE_WIDTH-1)edges.push(normalized[i+1]-normalized[i]);
  if(y<COVER_FEATURE_HEIGHT-1)edges.push(normalized[i+COVER_FEATURE_WIDTH]-normalized[i]);
 }
 return {luma:normalized,chroma,edges,contrast};
}

// Nine bounded bilinear samples per feature cell. The generator uses the same
// sampling rule, so reference generation does not depend on canvas resampling.
export function describeCoverPixels(image:PixelImage,crop:CoverCrop={x:0,y:0,width:image.width,height:image.height}):CoverDescriptor{
 const {width,height,data}=image;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||data.length!==width*height*4||!validCrop(crop,width,height))throw Error('Invalid scan frame.');
 const rgb:number[]=[];
 const pixel=(x:number,y:number,channel:number)=>{
  const px=Math.max(0,Math.min(width-1,x)),py=Math.max(0,Math.min(height-1,y)),left=Math.floor(px),top=Math.floor(py),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),dx=px-left,dy=py-top;
  return data[(top*width+left)*4+channel]*(1-dx)*(1-dy)+data[(top*width+right)*4+channel]*dx*(1-dy)+data[(bottom*width+left)*4+channel]*(1-dx)*dy+data[(bottom*width+right)*4+channel]*dx*dy;
 };
 for(let y=0;y<COVER_FEATURE_HEIGHT;y++)for(let x=0;x<COVER_FEATURE_WIDTH;x++)for(let channel=0;channel<3;channel++){
  let sum=0;
  for(let sy=0;sy<3;sy++)for(let sx=0;sx<3;sx++)sum+=pixel(crop.x+(x+(sx+.5)/3)*crop.width/COVER_FEATURE_WIDTH-.5,crop.y+(y+(sy+.5)/3)*crop.height/COVER_FEATURE_HEIGHT-.5,channel);
  rgb.push(sum/9);
 }
 return describeCoverThumbnail(rgb);
}

function validCrop(crop:CoverCrop,width:number,height:number){return [crop.x,crop.y,crop.width,crop.height].every(finite)&&crop.x>=0&&crop.y>=0&&crop.width>=2&&crop.height>=2&&crop.x+crop.width<=width+.001&&crop.y+crop.height<=height+.001;}

// Map the visible guide through object-fit:cover into the original video pixels.
// This keeps the guide and sampled camera region in agreement on either orientation.
export function comicGuideCrop(sourceWidth:number,sourceHeight:number,viewportWidth=sourceWidth,viewportHeight=sourceHeight):CoverCrop{
 if(![sourceWidth,sourceHeight,viewportWidth,viewportHeight].every(value=>finite(value)&&value>0))throw Error('Invalid camera dimensions.');
 const scale=Math.max(viewportWidth/sourceWidth,viewportHeight/sourceHeight);
 const guideHeight=Math.min(viewportHeight*.82,viewportWidth*.82/.70),guideWidth=guideHeight*.70;
 return {x:(sourceWidth-guideWidth/scale)/2,y:(sourceHeight-guideHeight/scale)/2,width:guideWidth/scale,height:guideHeight/scale};
}

export function coverCandidateCrops(width:number,height:number,options:{mode:'camera'|'upload';viewportWidth?:number;viewportHeight?:number}):CoverCrop[]{
 if(!finite(width)||!finite(height)||width<2||height<2)return [];
 const crops:CoverCrop[]=[],push=(crop:CoverCrop)=>{if(validCrop(crop,width,height))crops.push(crop)};
 if(options.mode==='upload'&&width/height>=.5&&width/height<=.95)push({x:0,y:0,width,height});
 const base=options.mode==='camera'?comicGuideCrop(width,height,options.viewportWidth||width,options.viewportHeight||height):(()=>{const h=Math.min(height,width/.70);return {x:(width-h*.70)/2,y:(height-h)/2,width:h*.70,height:h}})();
 const scales=options.mode==='camera'?[.96,1,1.04]:[1,.94,.86,.76,.66];
 for(const scale of scales)for(const aspect of [.94,1,1.04]){
  const w=base.width*scale*aspect,h=base.height*scale;
  push({x:base.x+(base.width-w)/2,y:base.y+(base.height-h)/2,width:w,height:h});
 }
 for(const [dx,dy] of [[-.025,0],[.025,0],[0,-.025],[0,.025]])push({...base,x:base.x+dx*base.width,y:base.y+dy*base.height});
 return crops;
}

function correlation(a:number[],b:number[]){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2}return Math.max(-1,Math.min(1,dot/Math.max(1e-9,Math.sqrt(aa*bb))))}
export function coverFeatureDistance(a:CoverDescriptor,b:CoverDescriptor){
 if(a.luma.length!==featureCount||b.luma.length!==featureCount||a.chroma.length!==featureCount*2||b.chroma.length!==featureCount*2||a.edges.length!==b.edges.length)throw Error('Invalid cover descriptor.');
 let chroma=0;for(let i=0;i<a.chroma.length;i++)chroma+=Math.abs(a.chroma[i]-b.chroma[i]);
 return .60*(1-correlation(a.luma,b.luma))/2+.25*Math.min(1,chroma/(a.chroma.length*.18))+.15*(1-correlation(a.edges,b.edges))/2;
}

export function parseCoverIndex(input:unknown):CoverIndex{
 if(!input||typeof input!=='object')throw Error('The cover index is unavailable.');
 const source=input as Record<string,unknown>;
 if(source.version!==1||source.width!==18||source.height!==26||!finite(source.maxDistance)||source.maxDistance<=0||source.maxDistance>.18||!finite(source.minMargin)||source.minMargin<.05||source.minMargin>.5||!Array.isArray(source.references)||!source.references.length||source.references.length>500)throw Error('The cover index is invalid.');
 const seen=new Set<number>();
 const references:CoverReference[]=source.references.map(value=>{
  if(!value||typeof value!=='object')throw Error('Invalid cover reference.');
  const ref=value as Record<string,unknown>;
  if(!Number.isSafeInteger(ref.catalogId)||Number(ref.catalogId)<0||seen.has(Number(ref.catalogId))||!Number.isInteger(ref.year)||Number(ref.year)<1900||Number(ref.year)>2100||['title','number','publisher','cover','sourceUrl','credit','sha256'].some(key=>typeof ref[key]!=='string'||!(ref[key] as string).trim())||!/^\/covers\/[a-z0-9-]+\.(jpg|png|webp)$/.test(String(ref.cover))||!/^https:\/\//.test(String(ref.sourceUrl))||!/^([a-f0-9]{64})$/.test(String(ref.sha256))||!Array.isArray(ref.rgb)||ref.rgb.length!==featureCount*3)throw Error('Invalid cover reference.');
  seen.add(Number(ref.catalogId));
  return {catalogId:Number(ref.catalogId),title:String(ref.title),number:String(ref.number),publisher:String(ref.publisher),year:Number(ref.year),cover:String(ref.cover),sourceUrl:String(ref.sourceUrl),credit:String(ref.credit),sha256:String(ref.sha256),descriptor:describeCoverThumbnail(ref.rgb)};
 });
 return {version:1,width:18,height:26,maxDistance:source.maxDistance,minMargin:source.minMargin,references};
}

export async function loadCoverIndex(fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<CoverIndex>{
 const response=await fetcher('/recognition/cover-index.json',{signal,cache:'no-store'});
 if(!response.ok)throw Error('The local cover index could not be loaded.');
 return parseCoverIndex(await response.json());
}

export function recognizeCoverPixels(image:PixelImage,index:CoverIndex,options:{mode:'camera'|'upload';viewportWidth?:number;viewportHeight?:number}):CoverRecognition{
 if(!index.references.length)return {status:'index_unavailable'};
 const candidates=coverCandidateCrops(image.width,image.height,options),scores=new Map<number,{reference:CoverReference;distance:number;crop:CoverCrop}>();
 for(const crop of candidates){
  const descriptor=describeCoverPixels(image,crop);
  // A flat wall, empty frame or badly obscured/underexposed crop cannot qualify.
  if(descriptor.contrast<.055)continue;
  for(const reference of index.references){
   const distance=coverFeatureDistance(descriptor,reference.descriptor),previous=scores.get(reference.catalogId);
   if(!previous||distance<previous.distance)scores.set(reference.catalogId,{reference,distance,crop});
  }
 }
 const ranked=[...scores.values()].sort((a,b)=>a.distance-b.distance),best=ranked[0];
 if(!best)return {status:'unknown'};
 const margin=(ranked[1]?.distance??1)-best.distance;
 return best.distance<=index.maxDistance&&margin>=index.minMargin?{status:'matched',suggestion:{...best,margin}}:{status:'unknown'};
}

export function createCoverConsensus(requiredFrames=3,minSpanMs=700){
 let id:number|null=null,count=0,first=0,last=-Infinity;
 return {
  push(result:CoverRecognition,timeMs:number):CoverSuggestion|null{
   if(!finite(timeMs))return null;
   if(result.status!=='matched'){id=null;count=0;first=0;last=timeMs;return null}
   // Reject duplicate/overlapping samples rather than counting the same frame.
   if(timeMs-last<300)return null;
   if(result.suggestion.reference.catalogId!==id||timeMs-last>1800){id=result.suggestion.reference.catalogId;count=0;first=timeMs}
   count++;last=timeMs;
   return count>=Math.max(3,requiredFrames)&&timeMs-first>=Math.max(700,minSpanMs)?result.suggestion:null;
  },
  reset(){id=null;count=0;first=0;last=-Infinity}
 };
}

export async function resolveRecognizedIssue(reference:CoverReference,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<ScanDirectoryResult>{
 try{
  const response=await fetcher('/api/catalog?id='+reference.catalogId,{signal,cache:'no-store'});
  // A broken/stale cover reference cannot establish absence from the directory.
  if(!response.ok)return {status:'index_unavailable'};
  const page=parseCatalogSearchPage(await response.json()),issue=page.issues[0];
  if(page.total!==1||page.issues.length!==1||!issue||issue.id!==reference.catalogId||cleanIdentity(issue.title)!==cleanIdentity(reference.title)||issue.number!==reference.number||issue.year!==reference.year||cleanIdentity(issue.publisher)!==cleanIdentity(reference.publisher))return {status:'index_unavailable'};
  return signal?.aborted?{status:'unknown'}:{status:'matched',issue};
 }catch{return signal?.aborted?{status:'unknown'}:{status:'index_unavailable'}}
}

// Require an explicit # issue marker. Loose OCR/barcodes remain search hints.
export function parseExactComicText(text:string):ExactComicText|null{
 const match=text.trim().match(/^([A-Za-z][A-Za-z0-9 '&:.,!/-]{1,95})\s+#\s*(\d{1,5}(?:\.\d{1,2})?)(?:\s*\((19\d{2}|20\d{2})\))?$/);
 if(!match)return null;
 return {title:match[1].trim(),number:match[2],...(match[3]?{year:Number(match[3])}:{})};
}
export async function lookupExactComicText(identity:ExactComicText,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<ScanDirectoryResult>{
 try{
  const params=new URLSearchParams({q:identity.title+' #'+identity.number+(identity.year?' '+identity.year:''),limit:'12',offset:'0'});
  const response=await fetcher('/api/catalog?'+params,{signal,cache:'no-store'});
  if(!response.ok)return {status:'index_unavailable'};
  const page=parseCatalogSearchPage(await response.json());
  if(signal?.aborted)return {status:'unknown'};
  // Only a successful, complete empty exact-identity search permits this state.
  if(page.total===0&&!page.hasMore)return {status:'not_in_directory'};
  const exact=page.issues.filter(issue=>cleanIdentity(issue.title)===cleanIdentity(identity.title)&&issue.number===identity.number&&(!identity.year||issue.year===identity.year));
  if(page.hasMore||exact.length!==1)return {status:'unknown'};
  const issue=exact[0];
  return resolveRecognizedIssue({catalogId:issue.id,title:issue.title,number:issue.number,publisher:issue.publisher,year:issue.year} as CoverReference,fetcher,signal);
 }catch{return signal?.aborted?{status:'unknown'}:{status:'index_unavailable'}}
}
