'use client';
import type {Worker as OcrWorker} from 'tesseract.js';
import type {Issue} from './catalog';
import {parseCatalogSearchPage} from './catalog-picker-client';
import {extractComicHints,rankCatalogCandidates,type ComicHints,type OcrLine,type OcrRegion} from './cover-ocr';

/**
 * Free on-device cover OCR tuned for comics. Reads three preprocessed views of
 * the upright photo: the masthead (top 38%, where the title is), the two top
 * corner boxes (issue number / price / date), then the whole cover; tries a
 * 90-degree turn if almost no text was found. Grayscale + contrast stretch.
 */
type Box={region:OcrRegion;x:number;y:number;w:number;h:number;width:number};
function views(width:number,height:number):Box[]{
 return ([
  {region:'masthead',x:0,y:0,w:1,h:.38,width:1600},
  {region:'corner',x:0,y:0,w:.34,h:.22,width:900},
  {region:'corner',x:.66,y:0,w:.34,h:.22,width:900},
  {region:'full',x:0,y:0,w:1,h:1,width:1400},
 ] as Box[]).map(box=>({...box,x:box.x*width,y:box.y*height,w:box.w*width,h:box.h*height}));
}
/** Grayscale and stretch the 2nd-98th percentile to full range, in place. */
export function enhanceForOcr(data:Uint8ClampedArray){
 const histogram=new Uint32Array(256),count=data.length/4;
 for(let i=0;i<data.length;i+=4){const g=(data[i]*299+data[i+1]*587+data[i+2]*114)/1000|0;data[i]=g;histogram[g]++}
 let low=0,high=255,seen=0;for(let v=0;v<256;v++){seen+=histogram[v];if(seen>=count*.02){low=v;break}}
 seen=0;for(let v=255;v>=0;v--){seen+=histogram[v];if(seen>=count*.02){high=v;break}}
 const span=Math.max(1,high-low);
 for(let i=0;i<data.length;i+=4){const v=Math.max(0,Math.min(255,(data[i]-low)*255/span));data[i]=data[i+1]=data[i+2]=v;data[i+3]=255}
}
function render(source:CanvasImageSource,box:Box,rotate=false){
 const scale=box.width/box.w,canvas=document.createElement('canvas'),w=Math.round(box.w*scale),h=Math.round(box.h*scale);
 canvas.width=rotate?h:w;canvas.height=rotate?w:h;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Canvas unavailable');
 if(rotate){context.translate(h,0);context.rotate(Math.PI/2)}
 context.imageSmoothingQuality='high';context.drawImage(source,box.x,box.y,box.w,box.h,0,0,w,h);
 const pixels=context.getImageData(0,0,canvas.width,canvas.height);enhanceForOcr(pixels.data);context.putImageData(pixels,0,0);return canvas;
}

export function createCoverOcr(){
 let pending:Promise<OcrWorker>|null=null,closed=false;
 async function worker(){
  if(closed)throw Error('OCR cancelled.');
  if(!pending)pending=import('tesseract.js').then(async({createWorker})=>{
   const instance=await createWorker('eng',1,{workerPath:'/ocr-runtime/worker.min.js',corePath:'/ocr-runtime/core',langPath:'/ocr-runtime/lang',workerBlobURL:false});
   if(closed){await instance.terminate();throw Error('OCR cancelled.')}
   await instance.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300'});return instance;
  }).catch(error=>{pending=null;throw error});
  return pending;
 }
 async function readCanvas(canvas:HTMLCanvasElement,region:OcrRegion):Promise<OcrLine[]>{
  const engine=await worker();if(closed)throw Error('OCR cancelled.');
  // Sparse-text mode finds big masthead letters; it returns nothing for a small
  // light box on a dark crop (the corner issue box), where automatic layout works.
  await engine.setParameters({tessedit_pageseg_mode:(region==='corner'?'3':'11') as never});
  const {data}=await engine.recognize(canvas,{},{text:true,blocks:true});
  return (data.blocks||[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.map(line=>({text:line.text,confidence:line.confidence,height:line.bbox.y1-line.bbox.y0,region}))));
 }
 return {
  /** source must already be upright (the browser applies EXIF orientation when drawing images). */
  async read(source:CanvasImageSource,width:number,height:number,signal?:AbortSignal):Promise<{hints:ComicHints;lines:OcrLine[]}>{
   const lines:OcrLine[]=[];
   for(const box of views(width,height)){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');lines.push(...await readCanvas(render(source,box),box.region))}
   const letters=lines.filter(line=>line.confidence>=40).map(line=>line.text).join('').replace(/[^A-Za-z]/g,'').length;
   if(letters<12&&!signal?.aborted){const full=views(width,height)[3];lines.push(...await readCanvas(render(source,full,true),'rotated'))}
   return {hints:extractComicHints(lines),lines};
  },
  close(){closed=true;const current=pending;pending=null;void current?.then(instance=>instance.terminate()).catch(()=>undefined)}
 };
}

/** Query the catalog with each hint combination and rank the union. */
export async function matchHintsToCatalog(hints:Pick<ComicHints,'titles'|'number'|'year'|'publisher'|'queries'>,signal?:AbortSignal,fetcher:typeof fetch=fetch){
 const results=await Promise.allSettled(hints.queries.slice(0,4).map(async q=>{const response=await fetcher('/api/catalog?'+new URLSearchParams({q,limit:'12',offset:'0'}),{signal,cache:'no-store'});if(!response.ok)throw Error('catalog');return parseCatalogSearchPage(await response.json())}));
 const issues:Issue[]=results.flatMap(result=>result.status==='fulfilled'?result.value.issues:[]);
 return {ranked:rankCatalogCandidates(hints,issues),reachable:results.some(result=>result.status==='fulfilled')};
}
