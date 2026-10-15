'use client';
export type DecodedComicBarcode={value:string;supplement:string;format:string;decoder:string};
/** CPU work is isolated from the UI; Safari does not need BarcodeDetector. */
export async function decodeComicBarcode(canvas:HTMLCanvasElement,signal:AbortSignal):Promise<DecodedComicBarcode|null>{
 let native:DecodedComicBarcode|null=null;
 const Detector=(window as unknown as {BarcodeDetector?:new(options:{formats:string[]})=>{detect:(source:HTMLCanvasElement)=>Promise<{rawValue:string;format:string}[]>}}).BarcodeDetector;
 if(Detector)try{const results=await Promise.race([new Detector({formats:['upc_a','upc_e','ean_13','ean_8','code_128']}).detect(canvas),new Promise<[]>(resolve=>setTimeout(()=>resolve([]),500))]);if(results[0])native={value:results[0].rawValue,supplement:'',format:results[0].format,decoder:'native-base-code'}}catch{}
 if(signal.aborted)return null;
 return new Promise(resolve=>{let worker:Worker;try{worker=new Worker(new URL('./barcode-decoder.worker.ts',import.meta.url))}catch{resolve(native);return}let finished=false;
  const finish=(value:DecodedComicBarcode|null)=>{if(finished)return;finished=true;clearTimeout(timeout);signal.removeEventListener('abort',abort);worker.terminate();resolve(signal.aborted?null:value||native)},abort=()=>finish(null),timeout=setTimeout(()=>finish(null),5000);
  signal.addEventListener('abort',abort,{once:true});worker.onmessage=event=>finish(event.data);worker.onerror=()=>finish(null);const context=canvas.getContext('2d',{willReadFrequently:true});if(!context){finish(null);return}const pixels=context.getImageData(0,0,canvas.width,canvas.height);worker.postMessage({width:pixels.width,height:pixels.height,data:pixels.data},[pixels.data.buffer]);
 });
}
