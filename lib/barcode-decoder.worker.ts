import {decodeBarcodePixels} from './barcode-reader';
self.onmessage=(event:MessageEvent<{width:number;height:number;data:Uint8ClampedArray}>)=>{self.postMessage(decodeBarcodePixels(event.data))};
