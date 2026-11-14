import sharp from 'sharp';
import {decodeLumaPixels,type DecodedPixels} from './barcode-reader';
import {photoDecodePlan} from './barcode-scan-plan';

/**
 * Server-side barcode reader for a still photo (free; no third-party calls).
 * EXIF-rotates, converts to grayscale, normalises contrast and unsharp-masks,
 * then tries the full photo at 1200/1800/2400 px and the corner/edge tiles at
 * native and 1.5x resolution, each at 0 and 90 degrees. 180/270 degrees are
 * covered because ZXing's TRY_HARDER also scans every row reversed.
 * The photo is processed in memory only and never stored.
 */
export type PhotoDecodeResult={code:DecodedPixels|null;attempts:number;elapsedMs:number;width:number;height:number};
export async function decodeBarcodePhoto(bytes:Buffer,options:{deadlineMs?:number}={}):Promise<PhotoDecodeResult>{
 const started=Date.now(),deadline=started+(options.deadlineMs||20000);
 const upright=await sharp(bytes,{limitInputPixels:50_000_000,failOn:'error'}).rotate().greyscale().normalise().toBuffer();
 const meta=await sharp(upright).metadata(),width=meta.width||0,height=meta.height||0;
 if(!width||!height)throw new Error('unreadable_image');
 let attempts=0;
 async function attempt(region:{left:number;top:number;width:number;height:number},targetWidth:number,sigma:number){
  attempts++;
  const {data,info}=await sharp(upright).extract(region).resize({width:Math.max(32,Math.round(targetWidth)),kernel:'lanczos3'}).sharpen({sigma}).greyscale().raw().toBuffer({resolveWithObject:true});
  const channels=info.channels||1;let luma:Uint8ClampedArray;
  if(channels===1)luma=new Uint8ClampedArray(data.buffer,data.byteOffset,data.length);else{luma=new Uint8ClampedArray(info.width*info.height);for(let i=0;i<luma.length;i++)luma[i]=data[i*channels]}
  return decodeLumaPixels(luma,info.width,info.height,2);
 }
 const full={left:0,top:0,width,height},steps:(()=>Promise<DecodedPixels|null>)[]=[];
 for(const size of [1200,1800,2400])if(size<=Math.max(width,height)*1.01)steps.push(()=>attempt(full,width*size/Math.max(width,height),1));
 for(const scale of [1,1.5])for(const tile of photoDecodePlan(width,height,{includeFull:false}))
  steps.push(()=>attempt({left:tile.x,top:tile.y,width:tile.width,height:tile.height},tile.width*Math.min(scale,Math.sqrt(9_000_000/(tile.width*tile.height))),1.2));
 for(const step of steps){
  if(Date.now()>deadline)break;
  const code=await step();if(code)return {code,attempts,elapsedMs:Date.now()-started,width,height};
 }
 return {code:null,attempts,elapsedMs:Date.now()-started,width,height};
}
