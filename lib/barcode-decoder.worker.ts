import {decodeBarcodePixels} from './barcode-reader';
// Persistent worker: one ZXing load serves every frame. Each job echoes its id.
self.onmessage=(event:MessageEvent<{id:number;width:number;height:number;data:Uint8ClampedArray;rotations:number;sharpen?:boolean|'only'}>)=>{
 const {id,...pixels}=event.data;let result=null;try{result=decodeBarcodePixels(pixels)}catch{}
 self.postMessage({id,result});
};
