'use client';
// Seller-side camera scan of the buyer's pickup QR. Uses the browser's BarcodeDetector when it
// supports QR, otherwise the QR reader in @zxing/library (already a dependency). Frames never leave
// the device. Manual 6-digit entry always remains available.
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {parsePickupPayload} from './pickup-qr';

type Detector={detect:(source:HTMLCanvasElement)=>Promise<{rawValue:string}[]>};
type DetectorClass={new(options:{formats:string[]}):Detector;getSupportedFormats?:()=>Promise<string[]>};

export default function PickupScanner({orderId,onCode,onClose}:{orderId:string;onCode:(code:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),[message,setMessage]=useState('Starting the camera…');
 useEffect(()=>{
  let stream:MediaStream|null=null,timer:ReturnType<typeof setTimeout>|null=null,stopped=false;
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  const stop=()=>{stopped=true;if(timer)clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop())};
  (async()=>{
   if(!navigator.mediaDevices?.getUserMedia||!context){setMessage('This browser can’t use the camera here. Type the 6-digit code instead.');return}
   try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false})}catch{setMessage('Camera access was blocked. Type the 6-digit code instead.');return}
   if(stopped){stop();return}
   const node=video.current;if(!node){stop();return}
   node.srcObject=stream;await node.play().catch(()=>undefined);setMessage('Point the camera at the buyer’s pickup QR code.');
   let native:Detector|null=null;
   const NativeDetector=(window as unknown as {BarcodeDetector?:DetectorClass}).BarcodeDetector;
   try{if(NativeDetector&&(!NativeDetector.getSupportedFormats||(await NativeDetector.getSupportedFormats()).includes('qr_code')))native=new NativeDetector({formats:['qr_code']})}catch{native=null}
   const zxing=native?null:await import('@zxing/library').catch(()=>null);
   const reader=zxing?new zxing.QRCodeReader():null;
   const tick=async()=>{
    if(stopped)return;
    const width=node.videoWidth,height=node.videoHeight;
    if(width&&height){
     const scale=Math.min(1,720/Math.max(width,height));canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
     context.drawImage(node,0,0,canvas.width,canvas.height);
     let text='';
     try{
      if(native){const found=await native.detect(canvas);text=found[0]?.rawValue||''}
      else if(zxing&&reader){const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,luma=new Uint8ClampedArray(canvas.width*canvas.height);for(let i=0,j=0;i<rgba.length;i+=4,j++)luma[j]=(rgba[i]*299+rgba[i+1]*587+rgba[i+2]*114)/1000;
       text=reader.decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(luma,canvas.width,canvas.height)))).getText()}
     }catch{text=''}
     if(text){const parsed=parsePickupPayload(text,orderId);if('code'in parsed){stop();onCode(parsed.code);return}setMessage(parsed.error)}
    }
    timer=setTimeout(()=>void tick(),250);
   };
   void tick();
  })();
  return stop;
 },[orderId,onCode]);
 return <div className="pickup-scanner" role="group" aria-label="Scan the buyer’s pickup code">
  <video ref={video} muted playsInline aria-hidden="true"/>
  <p role="status">{message}</p>
  <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onClose}><X size={15}/> Stop scanning</button>
 </div>;
}
