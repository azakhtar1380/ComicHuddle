import {MultiFormatReader,RGBLuminanceSource,HybridBinarizer,BinaryBitmap,DecodeHintType,BarcodeFormat,ResultMetadataType} from '@zxing/library';
import {readAddon} from './barcode-addon';
type Pixels={width:number;height:number;data:Uint8ClampedArray;rotations?:number}
export type DecodedPixels={value:string;supplement:string;format:string;decoder:string};
// Comics/books carry UPC-A, UPC-E or EAN-13 (ISBN). EAN-8 and Code 128 only produced
// false reads from partial bars in tests, so they are not accepted.
const formats=[BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.EAN_13];
// One reader per worker/process. With TRY_HARDER the 1D readers also scan each
// row reversed, so 180/270 degree turns would only repeat the 0/90 degree work.
let reader:MultiFormatReader|null=null;
const hints=new Map<DecodeHintType,unknown>([[DecodeHintType.POSSIBLE_FORMATS,formats],[DecodeHintType.TRY_HARDER,true]]);
function rotate(pixels:Uint8ClampedArray,w:number,h:number){const rotated=new Uint8ClampedArray(pixels.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)rotated[x*h+(h-1-y)]=pixels[y*w+x];return rotated}
/** rotations: 1 = as captured only (horizontal strip), 2 = also 90 degrees. */
export function decodeLumaPixels(luma:Uint8ClampedArray,width:number,height:number,rotations=2):DecodedPixels|null{
 let pixels=luma,w=width,h=height;
 reader||=new MultiFormatReader();reader.setHints(hints);
 for(let turn=0;turn<Math.max(1,Math.min(2,rotations));turn++){
  if(turn){pixels=rotate(pixels,w,h);[w,h]=[h,w]}
  try{
   const result=reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,w,h))));
   const format=BarcodeFormat[result.getBarcodeFormat()];
   let supplement=String(result.getResultMetadata()?.get(ResultMetadataType.UPC_EAN_EXTENSION)||'');
   // zxing-js drops the add-on digits (see barcode-addon.ts); read them ourselves.
   if(!supplement&&(format==='UPC_A'||format==='EAN_13'))supplement=readAddon(pixels,w,h,result.getResultPoints());
   return {value:result.getText(),supplement,format,decoder:'zxing'};
  }catch{}finally{reader.reset()}
 }
 return null;
}
/**
 * Unsharp mask (separable Gaussian). Phone photos of a 2-3 px/module barcode are
 * soft; restoring bar edges roughly doubled the decode rate on blurred fixtures.
 */
export function sharpenLuma(luma:Uint8ClampedArray,width:number,height:number,sigma=1.2,amount=1.5){
 const radius=Math.max(1,Math.ceil(sigma*2.5)),kernel:number[]=[];let total=0;
 for(let i=-radius;i<=radius;i++){const v=Math.exp(-(i*i)/(2*sigma*sigma));kernel.push(v);total+=v}
 for(let i=0;i<kernel.length;i++)kernel[i]/=total;
 const temp=new Float32Array(luma.length),out=new Uint8ClampedArray(luma.length);
 for(let y=0;y<height;y++){const row=y*width;for(let x=0;x<width;x++){let sum=0;for(let k=-radius;k<=radius;k++){const xx=x+k<0?0:x+k>=width?width-1:x+k;sum+=luma[row+xx]*kernel[k+radius]}temp[row+x]=sum}}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let k=-radius;k<=radius;k++){const yy=y+k<0?0:y+k>=height?height-1:y+k;sum+=temp[yy*width+x]*kernel[k+radius]}const i=y*width+x;out[i]=luma[i]+amount*(luma[i]-sum)}
 return out;
}
export function rgbaToLuma(data:Uint8ClampedArray,width:number,height:number){
 const luma=new Uint8ClampedArray(width*height);for(let i=0;i<luma.length;i++){const alpha=data[4*i+3]/255,gray=(data[4*i]*306+data[4*i+1]*601+data[4*i+2]*117+512)>>10;luma[i]=Math.round(gray*alpha+255*(1-alpha))}
 return luma;
}
/** sharpen: true = unsharp-masked copy first, then the original; 'only' = the sharpened copy only. */
export function decodeBarcodePixels({width,height,data,rotations=2,sharpen=false}:Pixels&{sharpen?:boolean|'only'}):DecodedPixels|null{
 const luma=rgbaToLuma(data,width,height);
 if(sharpen){const hit=decodeLumaPixels(sharpenLuma(luma,width,height),width,height,rotations);if(hit||sharpen==='only')return hit}
 return decodeLumaPixels(luma,width,height,rotations);
}
