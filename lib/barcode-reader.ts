import {MultiFormatReader,RGBLuminanceSource,HybridBinarizer,BinaryBitmap,DecodeHintType,BarcodeFormat,ResultMetadataType} from '@zxing/library';
type Pixels={width:number;height:number;data:Uint8ClampedArray}
const formats=[BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.CODE_128];
export function decodeBarcodePixels({width,height,data}:Pixels){
 const luma=new Uint8ClampedArray(width*height);for(let i=0;i<luma.length;i++){const alpha=data[4*i+3]/255,gray=(data[4*i]*306+data[4*i+1]*601+data[4*i+2]*117+512)>>10;luma[i]=Math.round(gray*alpha+255*(1-alpha))}
 let pixels=luma,w=width,h=height;
 for(let turn=0;turn<4;turn++){
  const hints=new Map<DecodeHintType,unknown>([[DecodeHintType.POSSIBLE_FORMATS,formats],[DecodeHintType.TRY_HARDER,true]]),reader=new MultiFormatReader();
  try{const result=reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,w,h))),hints);return {value:result.getText(),supplement:String(result.getResultMetadata()?.get(ResultMetadataType.UPC_EAN_EXTENSION)||''),format:BarcodeFormat[result.getBarcodeFormat()],decoder:'zxing'}}catch{}finally{reader.reset()}
  const rotated=new Uint8ClampedArray(pixels.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)rotated[x*h+(h-1-y)]=pixels[y*w+x];pixels=rotated;[w,h]=[h,w];
 }
 return null;
}
