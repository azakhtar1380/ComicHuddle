'use client';
import {useEffect,useRef,useState} from 'react';
import {Barcode,BookImage,Camera,Check,Circle,Crop,ExternalLink,ImagePlus,LoaderCircle,ScanLine,Search,ShieldCheck,ShoppingBag,Sparkles,Square,X} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import {stopComicCamera} from '../lib/comic-scan';
import {comicGuideCrop,resolveRecognizedIssue,type RecognitionStatus} from '../lib/cover-recognition';
import {createCoverOcr,matchHintsToCatalog} from '../lib/cover-ocr-client';
import ComicPicker from './comic-picker';
import ComicCover from './comic-cover';
import {barcodeStripCrop,barcodeStripGeometry,closeBarcodeDecoder,decodeComicBarcode,decodePhotoBarcode,type DecodedComicBarcode} from '../lib/barcode-decoder-client';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import CoverCropEditor from '../components/cover-crop-editor';
import './scan-comic.css';

const labels:Record<RecognitionStatus,string>={idle:'READY TO SCAN',starting:'STARTING CAMERA',scanning:'READING YOUR COVER',checking_directory:'SEARCHING THE CATALOG',matched:'LIKELY MATCH · CONFIRM EDITION',unknown:'CHECK THE RESULTS BELOW',not_in_directory:'NO CATALOG RESULT FOR THIS SEARCH',index_unavailable:'VISUAL INDEX UNAVAILABLE',permission_denied:'CAMERA PERMISSION NEEDED'};
type Aim='barcode'|'cover';
// Live loop: barcode decoding only. Cover OCR/visual matching runs on "Use this frame".
const BARCODE_INTERVAL=350,COVER_INTERVAL=700,SUPPLEMENT_GRACE=1200;
type MetronCandidate={metronId:number;title:string;number:string;publisher:string;year:number|null;cover:string|null;coverCredit:string|null;sourceUrl:string;upc:string;dataCredit:string};
function metronCandidates(value:unknown):MetronCandidate[]{
 if(!Array.isArray(value))return [];
 return value.flatMap(item=>{
  if(!item||typeof item!=='object')return [];const row=item as Record<string,unknown>;
  if(!Number.isSafeInteger(row.metronId)||typeof row.title!=='string'||!row.title)return [];
  const cover=typeof row.cover==='string'&&row.cover.startsWith('https://static.metron.cloud/')?row.cover:null;
  return [{metronId:row.metronId as number,title:row.title.slice(0,160),number:typeof row.number==='string'?row.number.slice(0,24):'',publisher:typeof row.publisher==='string'?row.publisher.slice(0,120):'',year:Number.isSafeInteger(row.year)?row.year as number:null,cover,
   coverCredit:cover&&typeof row.coverCredit==='string'?row.coverCredit.slice(0,200):null,sourceUrl:typeof row.sourceUrl==='string'&&row.sourceUrl.startsWith('https://metron.cloud/')?row.sourceUrl:'https://metron.cloud/',upc:typeof row.upc==='string'?row.upc.slice(0,18):'',dataCredit:typeof row.dataCredit==='string'?row.dataCredit.slice(0,200):'Issue data: Metron (metron.cloud), CC BY-SA 4.0'}];
 }).slice(0,6);
}
const codeLabel=(value:string,supplement:string)=>value+(supplement?' '+supplement:'');
// Still-photo identification steps, shown to the user in order.
type StepKey='device'|'server'|'lookup'|'ai'|'ocr';type StepState='running'|'done'|'failed';
type Step={key:StepKey;label:string;state:StepState;detail?:string};
const STEP_ORDER:StepKey[]=['device','server','lookup','ai','ocr'];
const PHOTO_TYPES=/^image\/(jpeg|png|webp|heic|heif)$/;
/** Phone photos: JPEG/PNG/WebP everywhere; HEIC/HEIF where the browser can decode it (Safari). */
function acceptablePhoto(file:File){return file.size>0&&file.size<=25*1024*1024&&(PHOTO_TYPES.test(file.type)||!file.type&&/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name||''))}
type AiCandidate={issue:Issue;score:number;numberMatch:boolean};
function canvasBlob(canvas:HTMLCanvasElement,maxSide:number,quality:number):Promise<Blob|null>{
 const scale=Math.min(1,maxSide/Math.max(canvas.width,canvas.height));let target=canvas;
 if(scale<1){target=document.createElement('canvas');target.width=Math.round(canvas.width*scale);target.height=Math.round(canvas.height*scale);const context=target.getContext('2d');if(!context)return Promise.resolve(null);context.imageSmoothingQuality='high';context.drawImage(canvas,0,0,target.width,target.height)}
 return new Promise(resolve=>{try{target.toBlob(blob=>resolve(blob),'image/jpeg',quality)}catch{resolve(null)}});
}
type Props={onOpen:(issue:Issue)=>void;onCollect:(issue:Issue)=>void;onBuy?:(issue:Issue)=>void;onClose:()=>void;startOnOpen?:boolean;confirmLabel?:string};
export default function ComicScan({onOpen,onCollect,onBuy,onClose,startOnOpen=false,confirmLabel='Confirm this comic & add to shelf'}:Props){
 const video=useRef<HTMLVideoElement>(null),box=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null),mounted=useRef(true),generation=useRef(0),controller=useRef<AbortController|null>(null),loopAbort=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),ocr=useRef<ReturnType<typeof createCoverOcr>|null>(null),photoCanvas=useRef<HTMLCanvasElement|null>(null),aiReady=useRef<boolean|null>(null),inFlight=useRef(false),cameraActive=useRef(false),previewRef=useRef(''),aimRef=useRef<Aim>('barcode'),pendingBase=useRef<{code:DecodedComicBarcode;at:number}|null>(null);
 const [camera,setCamera]=useState(false),[preview,setPreview]=useState(''),[editingCrop,setEditingCrop]=useState(false),[selected,setSelected]=useState<Issue|null>(null),[candidates,setCandidates]=useState<Issue[]>([]),[method,setMethod]=useState<'visual'|'text'|'manual'|'barcode'|'ai'>('manual'),[reading,setReading]=useState(false),[status,setStatus]=useState<RecognitionStatus>('idle'),[hint,setHint]=useState(''),[error,setError]=useState(''),[finder,setFinder]=useState(''),[manualOpen,setManualOpen]=useState(false),[dragging,setDragging]=useState(false),[viewport,setViewport]=useState({width:0,height:0});
 const [barcode,setBarcode]=useState(''),[supplement,setSupplement]=useState(''),[barcodeFormat,setBarcodeFormat]=useState(''),[aim,setAim]=useState<Aim>('barcode'),[external,setExternal]=useState<MetronCandidate[]>([]),[found,setFound]=useState<DecodedComicBarcode|null>(null),[steps,setSteps]=useState<Step[]>([]),[aiNote,setAiNote]=useState('');
 const current=(request:number)=>mounted.current&&generation.current===request;
 function clearTimer(){if(timer.current!==null)clearTimeout(timer.current);timer.current=null}
 function stopLoop(){loopAbort.current?.abort();loopAbort.current=null;pendingBase.current=null}
 function stopCamera(){clearTimer();stopLoop();cameraActive.current=false;stopComicCamera(stream.current);stream.current=null;setCamera(false)}
 function cancel(){generation.current++;clearTimer();controller.current?.abort();controller.current=null;ocr.current?.close();ocr.current=null;inFlight.current=false;stopCamera();return generation.current}
 function reset(){setSelected(null);setCandidates([]);setExternal([]);setFound(null);setSteps([]);setAiNote('');setFinder('');setManualOpen(false);setEditingCrop(false);setError('');setReading(false)}
 function setPhoto(url:string){previewRef.current=url;setPreview(url)}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;clearTimer();controller.current?.abort();loopAbort.current?.abort();ocr.current?.close();stopComicCamera(stream.current);closeBarcodeDecoder()}},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 useEffect(()=>{const target=box.current;if(!target)return;const measure=()=>setViewport({width:target.clientWidth,height:target.clientHeight});measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(target);return()=>observer.disconnect()},[]);
 useEffect(()=>{
  if(!camera||!video.current||!stream.current)return;const request=generation.current,frame=video.current;frame.srcObject=stream.current;
  void frame.play().then(()=>{if(current(request))schedule(request,300)}).catch(()=>{if(current(request)){setError('Tap the camera preview to start it, or upload a photo.');setStatus('unknown')}});
 },[camera]);
 useEffect(()=>{
  function visibility(){if(document.visibilityState==='hidden'){controller.current?.abort();ocr.current?.close();ocr.current=null;generation.current++;clearTimer();stopLoop();inFlight.current=false;stream.current?.getVideoTracks().forEach(track=>{track.enabled=false});setReading(false)}else if(cameraActive.current){stream.current?.getVideoTracks().forEach(track=>{track.enabled=true});schedule(generation.current,300)}}
  document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);
 },[]);
 useEffect(()=>{if(!startOnOpen)return;let cancelled=false;void Promise.resolve().then(()=>{if(!cancelled&&mounted.current)void startCamera()});return()=>{cancelled=true}},[startOnOpen]);
 function canvasFor(source:CanvasImageSource,width:number,height:number,maxSide=1500,crop?:{x:number;y:number;width:number;height:number}){
  const area=crop||{x:0,y:0,width,height},scale=Math.min(1,maxSide/Math.max(area.width,area.height)),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(area.width*scale));canvas.height=Math.max(2,Math.round(area.height*scale));const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('This browser cannot read the photo.');context.drawImage(source,area.x,area.y,area.width,area.height,0,0,canvas.width,canvas.height);return {canvas,pixels:context.getImageData(0,0,canvas.width,canvas.height)};
 }
 function guideFrame(frame:HTMLVideoElement){const target=box.current;return canvasFor(frame,frame.videoWidth,frame.videoHeight,1500,comicGuideCrop(frame.videoWidth,frame.videoHeight,target?.clientWidth||frame.videoWidth,target?.clientHeight||frame.videoHeight)).canvas}
 function saveFrame(canvas:HTMLCanvasElement,request:number){canvas.toBlob(blob=>{if(blob&&current(request))setPhoto(URL.createObjectURL(blob))},'image/jpeg',.9)}
 function showMatch(issue:Issue,source:'visual'|'text'|'manual'|'barcode'|'ai',request:number){if(!current(request))return;stopCamera();setSelected(issue);setMethod(source);setStatus('matched');setHint(source==='barcode'?'Found: '+issue.title+' #'+issue.number+(issue.year?' ('+issue.year+')':'')+' — confirm your printing and variant below.':source==='ai'||source==='text'?'Likely match: '+issue.title+' #'+issue.number+(issue.year?' ('+issue.year+')':'')+'. Confirm the year, printing and variant below; this is not an authenticity check.':'Selected: '+issue.title+' #'+issue.number+'. Confirm your printing and variant below.');}
 function aimHint(next:Aim){return next==='barcode'?'Looking for barcode… Fill the strip with the barcode, about a hand-width away. To read the title instead, tap “Use this frame”.':'Looking for a barcode anywhere on the cover… Tap “Use this frame” to read the title and issue number.'}
 /**
  * Still photo (upload or "Use this frame"), each step shown to the user:
  * barcode on device -> barcode on server -> catalog/Metron lookup -> AI cover
  * identification (only when the owner enabled it and free quota remains) ->
  * free on-device cover OCR + catalog matching -> manual search.
  */
 async function analyze(canvas:HTMLCanvasElement,request:number,options:{skipBarcode?:boolean}={}){
  if(!current(request))return;photoCanvas.current=canvas;setReading(true);setError('');setStatus('scanning');setSteps([]);setAiNote('');
  const abort=new AbortController();controller.current=abort;const deadline=setTimeout(()=>{abort.abort();ocr.current?.close();ocr.current=null},90000);
  const live=()=>current(request)&&!abort.signal.aborted;
  const step=(key:StepKey,label:string,state:StepState,detail?:string)=>{if(current(request))setSteps(list=>[...list.filter(item=>item.key!==key),{key,label,state,detail}].sort((a,b)=>STEP_ORDER.indexOf(a.key)-STEP_ORDER.indexOf(b.key)))};
  try{
   if(!options.skipBarcode){
    step('device','Reading the barcode on this device','running');setHint('Looking for a barcode in your photo…');
    let code=await decodePhotoBarcode(canvas,canvas.width,canvas.height,abort.signal,{budgetMs:10000});if(!live())return;
    step('device','Reading the barcode on this device',code?'done':'failed',code?codeLabel(code.value,code.supplement):'No barcode found');
    if(!code){
     step('server','Checking the photo for a barcode on our server','running');setHint('Checking the photo for a barcode…');
     code=await serverDecode(canvas,abort.signal);if(!live())return;
     step('server','Checking the photo for a barcode on our server',code?'done':'failed',code?codeLabel(code.value,code.supplement):'No barcode found');
    }
    if(code){
     const label=codeLabel(code.value,code.supplement);setFound(code);setBarcode(code.value);setSupplement(code.supplement);setBarcodeFormat(code.format);
     step('lookup','Looking up barcode '+label,'running');setStatus('checking_directory');setHint('Read barcode '+label+' — looking it up…');
     const matched=await lookupBarcode(code.value,code.supplement,request,abort.signal,code.format,false);if(!live())return;
     if(matched){step('lookup','Looking up barcode '+label,'done');return}
     step('lookup','Looking up barcode '+label,'failed','Not in our catalog yet');setHint('Read barcode '+label+' — not in our catalog yet. Identifying the cover instead…');
    }else setHint('Couldn’t read a barcode — identifying the cover instead. A closer, straight photo of the barcode also helps.');
   }
   setStatus('scanning');
   if(await aiAvailable(abort.signal)){
    if(!live())return;step('ai','Identifying the cover','running');setHint('Identifying the cover…');
    const ai=await identifyWithAi(canvas,abort.signal);if(!live())return;
    if(ai){
     const read=ai.identification,title=read.title?read.title+(read.issue_number?' #'+read.issue_number:''):'';
     setAiNote(title?'Cover reads: '+title+[read.publisher,read.year].filter(Boolean).map(value=>' · '+value).join('')+(read.variant_or_printing?' · '+read.variant_or_printing:''):'');
     if(ai.candidates.length){
      step('ai','Identifying the cover','done',title||undefined);setCandidates(ai.candidates.map(row=>row.issue));setMethod('ai');
      const [first,second]=ai.candidates;
      if(read.confidence!=='low'&&first.numberMatch&&first.score>=.75&&(!second||first.score-second.score>=.08))showMatch(first.issue,'ai',request);
      else{setStatus('unknown');setHint('Choose the matching edition below'+(title?' for “'+title+'”':'')+'. Confirm the year, printing and variant.')}
      return;
     }
     if(title){step('ai','Identifying the cover','done',title+' — no catalog match yet');setStatus('unknown');setFinder(title);setManualOpen(true);setHint('The cover reads “'+title+'”, but it isn’t in our catalog yet. Search below to pick the closest edition.');return}
    }
    // AI off, out of free quota, or unsure: continue quietly with the free path.
    setSteps(list=>list.filter(item=>item.key!=='ai'));
   }
   step('ocr','Matching by cover text','running');setHint('Matching by cover text…');
   ocr.current ||= createCoverOcr();
   const read=await Promise.race([ocr.current.read(canvas,canvas.width,canvas.height,abort.signal),new Promise<never>((_resolve,reject)=>{if(abort.signal.aborted)reject(Error('cancelled'));else abort.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})})]);if(!live())return;
   const {ranked}=await matchHintsToCatalog(read.hints,abort.signal);if(!live())return;
   const best=read.hints.titles[0]?read.hints.titles[0]+(read.hints.number?' #'+read.hints.number:''):'';
   setFinder(read.hints.queries[0]||'');
   if(ranked.length){
    step('ocr','Matching by cover text','done',best||undefined);setCandidates(ranked.slice(0,8).map(row=>row.issue));setMethod('text');
    const [first,second]=ranked;
    if(first.numberMatch&&first.score>=.8&&read.hints.numberEvidence==='explicit'&&(!second||first.score-second.score>=.1))showMatch(first.issue,'text',request);
    else{setStatus('unknown');setHint('The cover text matched these catalog editions. Choose yours below.')}
    return;
   }
   step('ocr','Matching by cover text','failed',best?'Read “'+best+'” — no catalog match':'No clear title text');
   setStatus('unknown');setManualOpen(true);
   setHint(best?'Read “'+best+'” from the cover, but found no catalog match. Search by title and issue below.':'Couldn’t read the cover text clearly. Try a straight, glare-free photo, or search by title and issue below.');
  }catch{if(current(request)){setStatus('unknown');setHint('Identification could not finish. Retry the photo or search by title and issue below.');setManualOpen(true)}}
  finally{clearTimeout(deadline);if(current(request)){controller.current=null;setReading(false)}}
 }
 async function serverDecode(canvas:HTMLCanvasElement,signal:AbortSignal):Promise<DecodedComicBarcode|null>{
  try{
   const blob=await canvasBlob(canvas,3000,.92);if(!blob||signal.aborted)return null;
   const response=await fetch('/api/recognition/decode',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob,signal,cache:'no-store'});if(!response.ok)return null;
   const data=await response.json();return data.found&&typeof data.value==='string'?{value:data.value,supplement:typeof data.supplement==='string'?data.supplement:'',format:String(data.format||''),decoder:'server'}:null;
  }catch{return null}
 }
 async function aiAvailable(signal:AbortSignal){
  if(aiReady.current!==null)return aiReady.current;
  try{const response=await fetch('/api/recognition/identify',{signal,cache:'no-store'});aiReady.current=response.ok&&(await response.json()).available===true}catch{aiReady.current=false}
  return aiReady.current;
 }
 async function identifyWithAi(canvas:HTMLCanvasElement,signal:AbortSignal):Promise<{identification:{title:string;issue_number:string;publisher:string;year:number|null;variant_or_printing:string;confidence:string};candidates:AiCandidate[]}|null>{
  try{
   const blob=await canvasBlob(canvas,1024,.85);if(!blob)return null;
   const response=await fetch('/api/recognition/identify',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob,signal,cache:'no-store'});if(!response.ok)return null;
   const data=await response.json();
   if(data.status!=='ok'){if(data.status==='unavailable')aiReady.current=false;return null}
   const page=parseCatalogSearchPage({issues:(data.candidates||[]).map((row:{issue:unknown})=>row.issue),total:(data.candidates||[]).length,limit:Math.max(1,(data.candidates||[]).length),offset:0,hasMore:false,issueCount:(data.candidates||[]).length,scope:'shared'});
   return {identification:data.identification,candidates:page.issues.map((issue,index)=>({issue,score:Number(data.candidates[index]?.score)||0,numberMatch:!!data.candidates[index]?.numberMatch}))};
  }catch{return null}
 }
 function schedule(request:number,delay=aimRef.current==='barcode'?BARCODE_INTERVAL:COVER_INTERVAL){clearTimer();if(current(request)&&cameraActive.current&&document.visibilityState==='visible')timer.current=setTimeout(()=>{timer.current=null;void scanFrame(request)},delay)}
 /** One live tick: decode a barcode only. Never OCR, never reopen manual search. */
 async function scanFrame(request:number){
  if(!current(request)||!cameraActive.current||inFlight.current)return;const frame=video.current;if(!frame?.videoWidth){schedule(request,300);return}
  inFlight.current=true;
  try{
   const target=box.current,width=target?.clientWidth||frame.videoWidth,height=target?.clientHeight||frame.videoHeight,strip=aimRef.current==='barcode';
   const crop=strip?barcodeStripCrop(frame.videoWidth,frame.videoHeight,width,height):comicGuideCrop(frame.videoWidth,frame.videoHeight,width,height);
   const {canvas}=canvasFor(frame,frame.videoWidth,frame.videoHeight,strip?1600:1200,crop);
   loopAbort.current||=new AbortController();const pending=pendingBase.current;
   // While waiting for an add-on, skip the native detector: it never reports supplements.
   const code=await decodeComicBarcode(canvas,loopAbort.current.signal,{rotations:strip?1:2,preferWorker:!!pending,timeoutMs:2500});
   if(!current(request)||!cameraActive.current)return;
   const now=performance.now();
   if(code&&(code.supplement||!/^\d{12,13}$/.test(code.value))){await acceptBarcode(code,request);return}
   if(code&&(!pending||pending.code.value!==code.value)){pendingBase.current={code,at:now};setHint('Barcode '+code.value+' read — hold still a moment for the small add-on digits…');return}
   if(pending&&now-pending.at>=SUPPLEMENT_GRACE){await acceptBarcode(pending.code,request);return}
  }catch{if(current(request))setHint('Hold the barcode inside the strip, or tap “Use this frame”.')}
  finally{if(current(request)){inFlight.current=false;if(cameraActive.current)schedule(request)}}
 }
 async function acceptBarcode(code:DecodedComicBarcode,request:number){
  pendingBase.current=null;
  try{navigator.vibrate?.(70)}catch{}
  const frame=video.current;if(frame?.videoWidth)try{saveFrame(guideFrame(frame),request)}catch{}
  stopCamera();setFound(code);setBarcode(code.value);setSupplement(code.supplement);setBarcodeFormat(code.format);
  setStatus('checking_directory');setReading(true);setHint('Barcode '+codeLabel(code.value,code.supplement)+' found — looking it up…');
  const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),12000);
  try{await lookupBarcode(code.value,code.supplement,request,abort.signal,code.format,true)}
  catch{if(current(request)){setStatus('unknown');setHint('Barcode lookup could not finish. Retry, or search by title below.');setManualOpen(true)}}
  finally{clearTimeout(timeout);if(current(request)){controller.current=null;setReading(false)}}
 }
 async function startCamera(){
  const request=cancel();reset();setPhoto('');setStatus('starting');setHint('Allow camera access to identify your comic.');
  try{if(window.isSecureContext===false)throw Error('Camera access needs HTTPS. Use the secure ComicHuddle link or upload a photo.');if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable here. Upload a photo instead.');let expired=false;
   // Landscape-native sizes; browsers rotate for portrait. Higher resolution keeps barcode bars sharp.
   const permission=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}},audio:false});void permission.then(late=>{if(expired||!current(request))stopComicCamera(late)}).catch(()=>undefined);let permissionTimer:ReturnType<typeof setTimeout>|undefined;const next=await Promise.race([permission,new Promise<never>((_resolve,reject)=>{permissionTimer=setTimeout(()=>{expired=true;reject(Error('Camera permission did not finish. Retry camera access or upload a photo.'))},15000)})]).finally(()=>clearTimeout(permissionTimer));if(!current(request)){stopComicCamera(next);return}
   stream.current=next;cameraActive.current=true;void tuneCamera(next);aimRef.current=aim;setCamera(true);setStatus('scanning');setHint(aimHint(aim))}
  catch(problem){if(!current(request))return;setStatus(problem instanceof DOMException&&problem.name==='NotAllowedError'?'permission_denied':'unknown');setError(problem instanceof DOMException&&problem.name==='NotAllowedError'?'Camera access was not granted. Allow it in browser settings or upload a photo.':problem instanceof Error?problem.message:'The camera could not start.');}
 }
 async function tuneCamera(media:MediaStream){
  // Continuous autofocus where the browser exposes it (Chrome on Android, newer Safari).
  const track=media.getVideoTracks?.()[0] as MediaStreamTrack|undefined;
  if(typeof track?.getCapabilities!=='function'||typeof track.applyConstraints!=='function')return;
  try{if((track.getCapabilities() as {focusMode?:string[]}).focusMode?.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'} as MediaTrackConstraintSet]})}catch{}
 }
 function switchAim(next:Aim){if(aimRef.current===next)return;aimRef.current=next;setAim(next);pendingBase.current=null;setHint(aimHint(next));if(cameraActive.current)schedule(generation.current,150)}
 /** Full-resolution upright copy (browsers apply EXIF orientation when drawing). Capped at 3200 px: barcode bars need native pixels. */
 function uprightCanvas(source:CanvasImageSource,width:number,height:number,maxSide=3200){const scale=Math.min(1,maxSide/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(width*scale));canvas.height=Math.max(2,Math.round(height*scale));const context=canvas.getContext('2d');if(!context)throw Error('This browser cannot read the photo.');context.imageSmoothingQuality='high';context.drawImage(source,0,0,canvas.width,canvas.height);return canvas}
 async function recognizePhoto(url:string,request:number,options:{skipBarcode?:boolean}={}){
  let canvas:HTMLCanvasElement;try{const image=new Image();image.src=url;await image.decode();if(!current(request))return;canvas=uprightCanvas(image,image.naturalWidth,image.naturalHeight)}
  catch{if(current(request)){setReading(false);setStatus('unknown');setManualOpen(true);setError('This photo could not be opened here. Use a JPEG or PNG photo (on iPhone, HEIC photos open in Safari; elsewhere choose Settings › Camera › Formats › Most Compatible).')}return}
  await analyze(canvas,request,options);
 }
 function choosePhoto(file:File){if(!acceptablePhoto(file)){setError('Choose a JPEG, PNG, WebP or HEIC photo up to 25 MB.');return}const request=cancel();reset();const url=URL.createObjectURL(file);setPhoto(url);void recognizePhoto(url,request)}
 function capture(){const frame=video.current;if(!frame?.videoWidth)return;try{const target=box.current,crop=comicGuideCrop(frame.videoWidth,frame.videoHeight,target?.clientWidth||frame.videoWidth,target?.clientHeight||frame.videoHeight),canvas=canvasFor(frame,frame.videoWidth,frame.videoHeight,3200,crop).canvas,request=cancel();reset();saveFrame(canvas,request);void analyze(canvas,request)}catch{setError('This frame could not be captured. Try an uploaded photo.')}}
 function retryPhoto(){if(!previewRef.current)return;const request=cancel();reset();void recognizePhoto(previewRef.current,request)}
 /** Skip the barcode and identify the cover directly (AI when enabled, otherwise free OCR). */
 function identifyCoverNow(){const canvas=photoCanvas.current;const request=cancel();reset();if(canvas)void analyze(canvas,request,{skipBarcode:true});else if(previewRef.current)void recognizePhoto(previewRef.current,request,{skipBarcode:true})}
 function framePhoto(){if(!previewRef.current)return;cancel();reset();setEditingCrop(true);setStatus('idle');setHint('Frame only the comic cover, then scan again. The crop stays on your device.');}
 function useCrop(blob:Blob){const request=cancel();reset();const url=URL.createObjectURL(blob);setPhoto(url);void recognizePhoto(url,request)}
 function chooseCandidate(issue:Issue|null){if(!issue){setSelected(null);return}const request=cancel();setReading(false);showMatch(issue,'manual',request)}
 function searchExternal(item:MetronCandidate){setFinder(item.title+(item.number?' #'+item.number:''));setManualOpen(true);setHint('Searching the ComicHuddle catalog for '+item.title+(item.number?' #'+item.number:'')+'. Choose the matching edition below.')}
 /** final=false inside a photo analysis: a miss continues to cover matching instead of opening search. */
 async function lookupBarcode(value:string,extension:string,request:number,signal:AbortSignal,format='',final=true){
  const response=await fetch('/api/recognition/barcode?'+new URLSearchParams({value,supplement:extension,format}),{signal,cache:'no-store'}),data=await response.json().catch(()=>({}));if(!current(request)||signal.aborted)return false;
  if(!response.ok){setHint(data.error||'Check the printed digits or use title and issue search.');if(final){setStatus('unknown');setManualOpen(true)}return false}
  const issues=Array.isArray(data.issues)?data.issues:[],page=parseCatalogSearchPage({issues,total:issues.length+(data.hasMore?1:0),limit:data.hasMore?12:Math.max(1,issues.length),offset:0,hasMore:!!data.hasMore,issueCount:issues.length,scope:'shared'});
  const others=metronCandidates(data.external),label=codeLabel(value,extension),notice=typeof data.notice==='string'?data.notice:'';
  setCandidates(page.issues);setExternal(others);setSelected(null);setMethod('barcode');
  if(page.issues.length===1){showMatch(page.issues[0],'barcode',request);setMethod('barcode');setHint('Found: '+page.issues[0].title+' #'+page.issues[0].number+(page.issues[0].year?' ('+page.issues[0].year+')':'')+' — confirm your printing and variant below. '+notice);return true}
  if(page.issues.length){stopCamera();setStatus('unknown');setHint(page.issues.length+(data.hasMore?'+':'')+' catalog editions share barcode '+label+'. Choose yours below. '+notice);return true}
  if(others.length){stopCamera();setStatus('unknown');const first=others[0];setHint('Metron lists barcode '+label+' as '+first.title+(first.number?' #'+first.number:'')+(first.year?' ('+first.year+')':'')+', but it is not linked to a ComicHuddle catalog record yet. Use “Find in catalog” below.');setFinder(first.title+(first.number?' #'+first.number:''));setManualOpen(true);return true}
  if(final){setStatus('unknown');setHint('Barcode '+label+' is not in the barcode index yet'+(data.metron?.status==='busy'?' (the Metron lookup is busy; retry in a minute)':'')+'. Tap “Read cover text” to identify it from the photo, or search by title below.');setManualOpen(true)}
  else setHint('Barcode '+label+' is not in the barcode index yet. Reading the cover instead…');
  return false;
 }
 async function searchBarcode(){const request=cancel();setReading(true);setError('');setSelected(null);setExternal([]);setStatus('checking_directory');const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),12000);try{await lookupBarcode(barcode,supplement,request,abort.signal,barcodeFormat,true)}catch{if(current(request)){setStatus('unknown');setHint('Barcode lookup could not finish. Use title and issue search.');setManualOpen(true)}}finally{clearTimeout(timeout);if(current(request)){controller.current=null;setReading(false)}}}
 async function confirmIssue(action:'collect'|'open'|'buy'){
  if(!selected||reading)return;const chosen=selected,request=cancel(),abort=new AbortController();controller.current=abort;setReading(true);setStatus('checking_directory');setError('');
  const verified=await resolveRecognizedIssue({catalogId:chosen.id,title:chosen.title,number:chosen.number,publisher:chosen.publisher,year:chosen.year} as Parameters<typeof resolveRecognizedIssue>[0],fetch,abort.signal);
  if(!current(request)||abort.signal.aborted)return;controller.current=null;setReading(false);
  if(verified.status!=='matched'){setStatus('index_unavailable');setError('The catalog record could not be verified. Retry or choose the issue again.');return}
  void fetch('/api/recognition/outcome',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:method==='manual'&&candidates.length?'corrected':'confirmed',issueId:verified.issue.id}),signal:AbortSignal.timeout(4000)}).catch(()=>undefined);onClose();if(action==='collect')onCollect(verified.issue);else if(action==='buy'&&onBuy)onBuy(verified.issue);else onOpen(verified.issue);
 }
 const guideHeight=Math.min(viewport.height*.82,viewport.width*.82/.70),guideWidth=guideHeight*.70,strip=viewport.width>0&&viewport.height>0?barcodeStripGeometry(viewport.width,viewport.height):null;
 const badge=camera&&status==='scanning'?(aim==='barcode'?'LOOKING FOR BARCODE':'LOOKING FOR A BARCODE · OR USE THIS FRAME'):labels[status];

 return <div className="form-dialog comic-scan">
  <div className="eyebrow"><ScanLine size={15}/> COMIC LENS</div><h2>POINT. SCAN.<br/><span>DISCOVER.</span></h2><p>Scan the printed barcode for the fastest match, capture the cover, or upload a photo. Confirm the exact issue before adding it. You can search by title and issue at any time.</p>
  {editingCrop&&preview&&<CoverCropEditor src={preview} onApply={useCrop} onCancel={()=>{setEditingCrop(false);setHint('Your original photo is ready. Retry the text scan or search the directory below.')}}/>}
  <div ref={box} hidden={editingCrop} className={'scan-capture'+(camera?' live':'')+(preview&&!camera?' has-photo':'')+(dragging?' is-dragging':'')} onDragOver={event=>{event.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);const file=event.dataTransfer.files[0];if(file)choosePhoto(file)}}>
   {camera?<video ref={video} autoPlay muted playsInline aria-label="Live comic barcode and cover scanner" onClick={()=>{void video.current?.play().then(()=>schedule(generation.current,100))}}/>:preview?<img src={preview} alt="Your comic photo, kept on this device"/>:<div className="scan-empty"><ScanLine size={48}/><strong>YOUR NEXT FIND.<br/>RIGHT IN THE FRAME.</strong><span>Barcode • Camera • Photo • Drag &amp; drop</span></div>}
   {camera&&aim==='barcode'&&<div className="scan-guide scan-guide-barcode" aria-hidden="true" style={strip?{width:strip.width,height:strip.height,left:strip.left,top:strip.top,transform:'none'}:undefined}><span className="scan-corner scan-tl"/><span className="scan-corner scan-tr"/><span className="scan-corner scan-bl"/><span className="scan-corner scan-br"/><span className="scan-laser"/><span className="scan-guide-label">BARCODE + ADD-ON IN THE STRIP</span></div>}
   {camera&&aim==='cover'&&<div className="scan-guide" aria-hidden="true" style={guideHeight>0?{width:guideWidth,height:guideHeight}:undefined}><span className="scan-corner scan-tl"/><span className="scan-corner scan-tr"/><span className="scan-corner scan-bl"/><span className="scan-corner scan-br"/><span className="scan-guide-label">ONE COVER · HOLD STEADY</span></div>}
   {camera&&<div className="scan-aim" role="group" aria-label="What to scan"><button type="button" aria-pressed={aim==='barcode'} onClick={()=>switchAim('barcode')}><Barcode size={14}/> Barcode</button><button type="button" aria-pressed={aim==='cover'} onClick={()=>switchAim('cover')}><BookImage size={14}/> Whole cover</button></div>}
   <span className={'scan-status-badge '+status}>{reading?<LoaderCircle size={13} className="scan-spin"/>:status==='matched'?<Check size={13}/>:<ScanLine size={13}/>} {badge}</span>
  </div>
  <div className="actions">{camera?<><button type="button" className="button red" onClick={capture}><Camera size={17}/> Use this frame</button><button type="button" className="button outline" onClick={()=>{cancel();setReading(false);setStatus('idle');setHint('Camera stopped. Start it again, upload a photo or search below.')}}><Square size={14}/> Stop camera</button></>:<button type="button" className="button red" disabled={status==='starting'} onClick={()=>void startCamera()}><Camera size={17}/> {found||selected?'Scan another comic':'Start camera'}</button>}<label className="button outline scan-upload"><ImagePlus size={17}/> Upload Image<input type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)choosePhoto(file)}}/></label></div>
  {error&&<p role="alert" className="scan-error">{error}</p>}<p role="status" aria-live="polite" className="scan-hint">{hint||'Point the camera at the barcode for an instant lookup. Automatic text reading can also find catalog books from a cover photo; the first text scan downloads the on-device reading model.'}</p>
  {steps.length>0&&<ol className="scan-steps" aria-label="Identification steps">{steps.map(item=><li key={item.key} className={'scan-step '+item.state}>{item.state==='running'?<LoaderCircle size={14} className="scan-spin"/>:item.state==='done'?<Check size={14}/>:item.state==='failed'?<X size={14}/>:<Circle size={14}/>}<span>{item.label}{item.detail&&<small>{item.detail}</small>}</span></li>)}</ol>}
  {aiNote&&<p className="scan-ai-note"><Sparkles size={14}/> {aiNote}</p>}
  {preview&&!camera&&!reading&&!selected&&<div className="actions scan-followup"><button type="button" className="button outline" onClick={identifyCoverNow}><BookImage size={15}/> Identify from cover photo</button></div>}
  {selected&&<div className="scan-confirm"><ComicCover issueId={selected.id} publisher={selected.publisher} year={selected.year} src={selected.cover} credit={selected.coverCredit} title={selected.title} issue={selected.number}/><div><span className="scan-match-label"><Check size={15}/> LIKELY MATCH{method==='ai'?' · COVER':method==='text'?' · COVER TEXT':method==='visual'?' · COVER FEATURES':method==='barcode'?' · BARCODE':' · SELECTED EDITION'}</span><strong>Likely match: {selected.title} #{selected.number}{selected.year?' ('+selected.year+')':''}</strong><p>{selected.publisher} · {selected.variant}</p><small>Confirm your printing and variant. Matching does not authenticate, grade or detect a counterfeit.</small></div><div className="actions"><button type="button" className="button red" disabled={reading} onClick={()=>void confirmIssue('collect')}>{confirmLabel}</button><button type="button" className="button outline" disabled={reading} onClick={()=>void confirmIssue('open')}>View comic info</button>{onBuy&&<button type="button" className="button outline" disabled={reading} onClick={()=>void confirmIssue('buy')}><ShoppingBag size={15}/> Find copies to buy</button>}</div></div>}
  {candidates.length>0&&<div className="scan-candidates"><h3>Confirm the matching edition</h3>{candidates.map(issue=><button type="button" key={issue.id} aria-pressed={selected?.id===issue.id} onClick={()=>chooseCandidate(issue)}><span><strong>{issue.title} #{issue.number}</strong><small>{issue.year||'Date pending'} · {issue.publisher} · {issue.variant}</small></span><Check size={16}/></button>)}</div>}
  {external.length>0&&<div className="scan-external"><h3>Found on Metron</h3><p>These records match the barcode but are not linked to a ComicHuddle catalog entry yet. Find the matching catalog edition to add it.</p>{external.map(item=><div key={item.metronId} className="scan-external-item">{item.cover?<img src={item.cover} alt={item.title+(item.number?' #'+item.number:'')+' reference cover'} loading="lazy" referrerPolicy="no-referrer"/>:<span className="scan-external-blank" aria-hidden="true"><BookImage size={20}/></span>}<span className="scan-external-text"><strong>{item.title}{item.number?' #'+item.number:''}</strong><small>{[item.year,item.publisher].filter(Boolean).join(' · ')||'Details on Metron'}</small>{item.coverCredit&&<small>{item.coverCredit}</small>}<small>{item.dataCredit}</small></span><span className="scan-external-actions"><button type="button" className="button outline small-button" onClick={()=>searchExternal(item)}><Search size={14}/> Find in catalog</button><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Metron <ExternalLink size={12}/></a></span></div>)}</div>}
  <div className="scan-secondary"><button type="button" className="scan-manual-toggle" aria-expanded={manualOpen} onClick={()=>setManualOpen(value=>!value)}><Search size={16}/> {manualOpen?'Hide directory search':'Search directory manually'}</button>{preview&&!camera&&!editingCrop&&<><button type="button" onClick={framePhoto}><Crop size={15}/> Adjust cover frame</button><button type="button" disabled={reading} onClick={retryPhoto}>Retry photo &amp; text</button></>}</div>
  <form className="scan-barcode-entry" onSubmit={event=>{event.preventDefault();void searchBarcode()}}><label>UPC / EAN / ISBN<input value={barcode} onChange={event=>{setBarcode(event.target.value);setBarcodeFormat('')}} inputMode="numeric" maxLength={80} placeholder="Enter the complete printed code"/></label><label>Supplement, if visible<input value={supplement} onChange={event=>setSupplement(event.target.value)} inputMode="numeric" maxLength={5} placeholder="2 or 5 digits"/></label><button type="submit" className="button outline small-button" disabled={reading||!barcode.trim()}>Look up barcode</button><small>The small 5-digit add-on to the right of the main barcode identifies the issue and printing. A base barcode alone can match several editions; use title search if no indexed match is found.</small></form>
  {manualOpen&&<ComicPicker key={finder} value={selected} initialQuery={finder} onQueryChange={()=>{if(reading){cancel();setReading(false);setStatus('idle');setHint('Search the directory and confirm the exact edition below.')}}} onChange={chooseCandidate}/>}
  <p className="scan-privacy"><ShieldCheck size={15}/> Photos are read on your device first. If the barcode can’t be read there, the photo is checked on ComicHuddle’s server, and when cover identification is enabled it is also sent to Google Gemini to read the cover. Photos are never stored, and you always confirm the exact issue before saving. Attaching a photo to a public listing is a separate action.</p><p className="data-caption">Barcode first, then the cover itself. Variant and printing confirmation remain yours. JPEG, PNG, WebP or HEIC up to 25 MB.</p>
 </div>;
}