'use client';
export type DecodedComicBarcode={value:string;supplement:string;format:string;decoder:string};
export type BarcodeDecodeOptions={
 /** 1 = horizontal strip only, 2 = also try 90 degrees (whole-cover photos). */
 rotations?:1|2;
 /** Skip the native detector: it never reports the 2/5-digit supplement. */
 preferWorker?:boolean;
 timeoutMs?:number;
 /** Unsharp-mask before decoding (still photos). */
 sharpen?:boolean|'only';
};
type NativeDetector={detect:(source:HTMLCanvasElement)=>Promise<{rawValue:string;format:string}[]>};
type NativeDetectorClass={new(options:{formats:string[]}):NativeDetector;getSupportedFormats?:()=>Promise<string[]>};
const wanted=['upc_a','upc_e','ean_13'];
let nativeDetector:Promise<NativeDetector|null>|null=null;
function detector(){
 if(nativeDetector)return nativeDetector;
 const Detector=(globalThis as unknown as {window?:{BarcodeDetector?:NativeDetectorClass}}).window?.BarcodeDetector;
 nativeDetector=!Detector?Promise.resolve(null):(async()=>{
  try{const supported=Detector.getSupportedFormats?await Detector.getSupportedFormats():wanted;const formats=wanted.filter(format=>supported.includes(format));return formats.length?new Detector({formats}):null}catch{return null}
 })();
 return nativeDetector;
}

// One persistent worker for the scanner session; jobs are matched by id.
type Job={resolve:(value:DecodedComicBarcode|null)=>void;timer:ReturnType<typeof setTimeout>};
let worker:Worker|null=null,workerBroken=false,nextId=1;const jobs=new Map<number,Job>();
function settleAll(){for(const [id,job] of jobs){clearTimeout(job.timer);jobs.delete(id);job.resolve(null)}}
function decoderWorker(){
 if(worker||workerBroken)return worker;
 try{
  worker=new Worker(new URL('./barcode-decoder.worker.ts',import.meta.url));
  worker.onmessage=(event:MessageEvent<{id:number;result:DecodedComicBarcode|null}>)=>{const job=jobs.get(event.data?.id);if(!job)return;jobs.delete(event.data.id);clearTimeout(job.timer);job.resolve(event.data.result||null)};
  worker.onerror=()=>{closeBarcodeDecoder();workerBroken=true};
 }catch{workerBroken=true;worker=null}
 return worker;
}
/** Terminates the worker. The next decode creates a fresh one. */
export function closeBarcodeDecoder(){worker?.terminate();worker=null;settleAll()}

async function mainThreadDecode(pixels:ImageData,rotations:number,sharpen:boolean|'only'=false){
 // Fallback for browsers without module-worker support. Bounded image sizes keep it short.
 const {decodeBarcodePixels}=await import('./barcode-reader');
 try{return decodeBarcodePixels({width:pixels.width,height:pixels.height,data:pixels.data,rotations,sharpen})}catch{return null}
}

import {photoDecodePlan} from './barcode-scan-plan';
/**
 * Still photo (upload or captured frame): try the shared tiled plan - full image,
 * then corner/edge tiles at native resolution, sharpened - until one reads.
 */
export async function decodePhotoBarcode(source:CanvasImageSource,width:number,height:number,signal:AbortSignal,options:{budgetMs?:number;onAttempt?:(index:number,total:number)=>void}={}):Promise<DecodedComicBarcode|null>{
 const plan=photoDecodePlan(width,height,{maxPixels:3_000_000}),deadline=Date.now()+(options.budgetMs||12000);
 for(let index=0;index<plan.length;index++){
  if(signal.aborted||Date.now()>deadline)return null;options.onAttempt?.(index+1,plan.length);
  const region=plan[index],canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(region.width*region.scale));canvas.height=Math.max(2,Math.round(region.height*region.scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;context.imageSmoothingQuality='high';context.drawImage(source,region.x,region.y,region.width,region.height,0,0,canvas.width,canvas.height);
  // Native detector only on the whole image; tiles go to ZXing (sharpened, reads the add-on).
  const code=await decodeComicBarcode(canvas,signal,{rotations:region.rotations,preferWorker:index>0,sharpen:region.sharpen,timeoutMs:3500});
  if(code)return code;
 }
 return null;
}
export async function decodeComicBarcode(canvas:HTMLCanvasElement,signal:AbortSignal,options:BarcodeDecodeOptions={}):Promise<DecodedComicBarcode|null>{
 const rotations=options.rotations||2,timeoutMs=options.timeoutMs||4000;
 if(!options.preferWorker){
  const native=await detector();
  if(native&&!signal.aborted)try{
   let timer:ReturnType<typeof setTimeout>|undefined;
   const results=await Promise.race([native.detect(canvas),new Promise<[]>(resolve=>{timer=setTimeout(()=>resolve([]),400)})]).finally(()=>clearTimeout(timer));
   const hit=results.find(result=>/^\d{8,13}$/.test(result.rawValue)&&wanted.includes(result.format));
   if(hit)return signal.aborted?null:{value:hit.rawValue,supplement:'',format:hit.format,decoder:'native'};
  }catch{}
 }
 if(signal.aborted)return null;
 const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
 const pixels=context.getImageData(0,0,canvas.width,canvas.height);
 const target=decoderWorker();
 if(!target){const result=await mainThreadDecode(pixels,rotations,options.sharpen);return signal.aborted?null:result}
 return new Promise(resolve=>{
  const id=nextId++;let done=false;
  const finish=(value:DecodedComicBarcode|null)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);resolve(signal.aborted?null:value)};
  const abort=()=>{const job=jobs.get(id);if(job){clearTimeout(job.timer);jobs.delete(id)}finish(null)};
  // A stuck decode blocks later frames, so a timeout replaces the worker.
  const timer=setTimeout(()=>{jobs.delete(id);closeBarcodeDecoder();finish(null)},timeoutMs);
  jobs.set(id,{resolve:finish,timer});signal.addEventListener('abort',abort,{once:true});
  try{target.postMessage({id,width:pixels.width,height:pixels.height,data:pixels.data,rotations,sharpen:options.sharpen||false},[pixels.data.buffer])}catch{clearTimeout(timer);jobs.delete(id);finish(null)}
 });
}

/** The barcode strip drawn over the camera preview, in viewport pixels. */
export function barcodeStripGeometry(viewportWidth:number,viewportHeight:number){
 const width=Math.min(viewportWidth*.86,560),height=Math.min(width*.42,viewportHeight*.45);
 return {width,height,left:(viewportWidth-width)/2,top:Math.max(0,viewportHeight*.56-height/2)};
}
/** Map the strip (plus a tolerance margin) through object-fit:cover into video pixels. */
export function barcodeStripCrop(sourceWidth:number,sourceHeight:number,viewportWidth=sourceWidth,viewportHeight=sourceHeight){
 if(![sourceWidth,sourceHeight,viewportWidth,viewportHeight].every(value=>Number.isFinite(value)&&value>0))throw Error('Invalid camera dimensions.');
 const scale=Math.max(viewportWidth/sourceWidth,viewportHeight/sourceHeight),offsetX=(viewportWidth-sourceWidth*scale)/2,offsetY=(viewportHeight-sourceHeight*scale)/2;
 const strip=barcodeStripGeometry(viewportWidth,viewportHeight),marginX=strip.width*.08,marginY=strip.height*.25;
 const x0=Math.max(0,(strip.left-marginX-offsetX)/scale),y0=Math.max(0,(strip.top-marginY-offsetY)/scale);
 const x1=Math.min(sourceWidth,(strip.left+strip.width+marginX-offsetX)/scale),y1=Math.min(sourceHeight,(strip.top+strip.height+marginY-offsetY)/scale);
 return {x:x0,y:y0,width:Math.max(2,x1-x0),height:Math.max(2,y1-y0)};
}
