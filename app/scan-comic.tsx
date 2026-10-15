'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Check,ImagePlus,LoaderCircle,ScanLine,Search,ShieldCheck,ShoppingBag,Square} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import {safeScanImage,stopComicCamera} from '../lib/comic-scan';
import {comicGuideCrop,resolveRecognizedIssue,type RecognitionStatus} from '../lib/cover-recognition';
import {lookupVisualCover} from '../lib/scan-visual-client';
import {createComicOcr} from '../lib/scan-ocr-client';
import {extractCoverTextHints,lookupCoverText} from '../lib/scan-text';
import ComicPicker from './comic-picker';
import ComicCover from './comic-cover';
import './scan-comic.css';

const labels:Record<RecognitionStatus,string>={idle:'READY TO SCAN',starting:'STARTING CAMERA',scanning:'READING YOUR COVER',checking_directory:'SEARCHING THE CATALOG',matched:'MATCH FOUND · CONFIRM EDITION',unknown:'CHECK THE COVER TEXT BELOW',not_in_directory:'NO CATALOG RESULT FOR THIS SEARCH',index_unavailable:'VISUAL INDEX UNAVAILABLE',permission_denied:'CAMERA PERMISSION NEEDED'};
type Props={onOpen:(issue:Issue)=>void;onCollect:(issue:Issue)=>void;onBuy?:(issue:Issue)=>void;onClose:()=>void;startOnOpen?:boolean};
export default function ComicScan({onOpen,onCollect,onBuy,onClose,startOnOpen=false}:Props){
 const video=useRef<HTMLVideoElement>(null),box=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null),mounted=useRef(true),generation=useRef(0),controller=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),ocr=useRef<ReturnType<typeof createComicOcr>|null>(null),inFlight=useRef(false),cameraActive=useRef(false),previewRef=useRef('');
 const [camera,setCamera]=useState(false),[preview,setPreview]=useState(''),[selected,setSelected]=useState<Issue|null>(null),[candidates,setCandidates]=useState<Issue[]>([]),[method,setMethod]=useState<'visual'|'text'|'manual'>('manual'),[reading,setReading]=useState(false),[status,setStatus]=useState<RecognitionStatus>('idle'),[hint,setHint]=useState(''),[error,setError]=useState(''),[finder,setFinder]=useState(''),[manualOpen,setManualOpen]=useState(false),[dragging,setDragging]=useState(false),[viewport,setViewport]=useState({width:0,height:0}),[visionSetup,setVisionSetup]=useState<{available:boolean;reason?:string}|null>(null);
 const current=(request:number)=>mounted.current&&generation.current===request;
 function clearTimer(){if(timer.current!==null)clearTimeout(timer.current);timer.current=null}
 function stopCamera(){clearTimer();cameraActive.current=false;stopComicCamera(stream.current);stream.current=null;setCamera(false)}
 function cancel(){generation.current++;clearTimer();controller.current?.abort();controller.current=null;ocr.current?.close();ocr.current=null;inFlight.current=false;stopCamera();return generation.current}
 function reset(){setSelected(null);setCandidates([]);setFinder('');setManualOpen(false);setError('');setReading(false)}
 function setPhoto(url:string){previewRef.current=url;setPreview(url)}
 useEffect(()=>{const abort=new AbortController();void fetch('/api/recognition/vision',{signal:abort.signal}).then(response=>response.json()).then(value=>{if(!abort.signal.aborted)setVisionSetup(value)}).catch(()=>{if(!abort.signal.aborted)setVisionSetup({available:false,reason:'Enhanced vision could not connect.'})});return()=>abort.abort()},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;clearTimer();controller.current?.abort();ocr.current?.close();stopComicCamera(stream.current)}},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 useEffect(()=>{const target=box.current;if(!target)return;const measure=()=>setViewport({width:target.clientWidth,height:target.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(target);return()=>observer.disconnect()},[]);
 useEffect(()=>{
  if(!camera||!video.current||!stream.current)return;const request=generation.current,frame=video.current;frame.srcObject=stream.current;
  void frame.play().then(()=>{if(current(request))schedule(request,200)}).catch(()=>{if(current(request)){setError('Tap the camera preview to start it, or upload a photo.');setStatus('unknown')}});
 },[camera]);
 useEffect(()=>{
  function visibility(){if(document.visibilityState==='hidden'){controller.current?.abort();ocr.current?.close();ocr.current=null;generation.current++;clearTimer();inFlight.current=false;stream.current?.getVideoTracks().forEach(track=>{track.enabled=false});setReading(false)}else if(cameraActive.current){stream.current?.getVideoTracks().forEach(track=>{track.enabled=true});schedule(generation.current,200)}}
  document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);
 },[]);
 useEffect(()=>{if(!startOnOpen)return;let cancelled=false;void Promise.resolve().then(()=>{if(!cancelled&&mounted.current)void startCamera()});return()=>{cancelled=true}},[startOnOpen]);
 function canvasFor(source:CanvasImageSource,width:number,height:number,maxSide=1500,crop?:{x:number;y:number;width:number;height:number}){
  const area=crop||{x:0,y:0,width,height},scale=Math.min(1,maxSide/Math.max(area.width,area.height)),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(area.width*scale));canvas.height=Math.max(2,Math.round(area.height*scale));const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('This browser cannot read the photo.');context.drawImage(source,area.x,area.y,area.width,area.height,0,0,canvas.width,canvas.height);return {canvas,pixels:context.getImageData(0,0,canvas.width,canvas.height)};
 }
 function saveFrame(canvas:HTMLCanvasElement,request:number){canvas.toBlob(blob=>{if(blob&&current(request))setPhoto(URL.createObjectURL(blob))},'image/jpeg',.9)}
 function showMatch(issue:Issue,source:'visual'|'text'|'manual',request:number){if(!current(request))return;stopCamera();setSelected(issue);setMethod(source);setStatus('matched');setHint(source==='visual'?'Cover art matched a database fingerprint. Confirm your printing and variant before saving.':'Catalog match from the cover text. Confirm the year, printing and variant; this is not an authenticity check.');}
 async function analyze(canvas:HTMLCanvasElement,request:number,mode:'camera'|'upload'){
  if(!current(request))return;setReading(true);setError('');setStatus('scanning');setHint('Comparing cover features with the database…');
  const abort=new AbortController();controller.current=abort;let visualUnavailable=false;
  try{
   const small=canvasFor(canvas,canvas.width,canvas.height,640);
   try{
    const visual=await lookupVisualCover(small.pixels,{mode:'upload'},abort.signal);if(!current(request))return;
    setCandidates(visual.candidates);
    if(visual.match){if(mode==='camera')saveFrame(canvas,request);showMatch(visual.match,'visual',request);return}
   }catch{if(!current(request))return;visualUnavailable=true;}
   setStatus('scanning');setHint('Reading the title, issue number and publisher on your device…');
   ocr.current ||= createComicOcr();
   const hints=await ocr.current.read(canvas);if(!current(request)||abort.signal.aborted)return;
   setStatus('checking_directory');setHint('Searching the central catalog using the cover text…');
   const result=await lookupCoverText(hints,fetch,abort.signal);if(!current(request)||abort.signal.aborted)return;
   setFinder(result.searchText);setCandidates(previous=>[...new Map([...result.candidates,...previous].map(issue=>[issue.id,issue])).values()].slice(0,8));
   if(result.match){if(mode==='camera')saveFrame(canvas,request);showMatch(result.match,'text',request);return}
   setStatus('unknown');
   setHint(result.candidates.length?'The cover text found these catalog editions. Choose the matching year and variant below.':result.empty?'No catalog results for the text read from this photo. Check the reading below; a failed scan does not establish that the book is absent.':visualUnavailable?'The visual index could not connect, and no clear title was read. Retry a closer photo or search below.':'The cover text was not clear enough. Try a straight, glare-free photo or enter the title and issue below.');
   if(!result.candidates.length)setManualOpen(true);
  }catch{if(current(request)){setStatus('unknown');setHint('Automatic text reading or catalog lookup could not finish. Retry the photo or enter the title and issue below.');setManualOpen(true)}}
  finally{if(current(request)){controller.current=null;setReading(false)}}
 }
 function schedule(request:number,delay=7000){clearTimer();if(current(request)&&cameraActive.current&&document.visibilityState==='visible')timer.current=setTimeout(()=>{timer.current=null;void scanFrame(request)},delay)}
 async function scanFrame(request:number){
  if(!current(request)||!cameraActive.current||inFlight.current)return;const frame=video.current;if(!frame?.videoWidth){schedule(request,400);return}
  inFlight.current=true;
  try{const target=box.current,crop=comicGuideCrop(frame.videoWidth,frame.videoHeight,target?.clientWidth||frame.videoWidth,target?.clientHeight||frame.videoHeight),{canvas}=canvasFor(frame,frame.videoWidth,frame.videoHeight,1500,crop);await analyze(canvas,request,'camera')}
  catch{if(current(request)){setStatus('unknown');setHint('Hold one cover in the guide or choose a photo.')}}
  finally{if(current(request)){inFlight.current=false;schedule(request)}}
 }
 async function startCamera(){
  const request=cancel();reset();setPhoto('');setStatus('starting');setHint('Allow camera access to identify your comic.');
  try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable here. Upload a photo instead.');const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1920}},audio:false});if(!current(request)){stopComicCamera(next);return}stream.current=next;cameraActive.current=true;setCamera(true);setStatus('scanning')}
  catch(problem){if(!current(request))return;setStatus(problem instanceof DOMException&&problem.name==='NotAllowedError'?'permission_denied':'unknown');setError(problem instanceof DOMException&&problem.name==='NotAllowedError'?'Camera access was not granted. Allow it in browser settings or upload a photo.':problem instanceof Error?problem.message:'The camera could not start.');}
 }
 async function recognizePhoto(url:string,request:number){
  try{const image=new Image();image.src=url;await image.decode();if(!current(request))return;const {canvas}=canvasFor(image,image.naturalWidth,image.naturalHeight);await analyze(canvas,request,'upload')}
  catch{if(current(request)){setReading(false);setStatus('unknown');setError('The photo could not be opened. Use JPEG, PNG or WebP.')}}
 }
 function choosePhoto(file:File){if(!safeScanImage(file)){setError('Choose a JPEG, PNG or WebP photo up to 10 MB.');return}const request=cancel();reset();const url=URL.createObjectURL(file);setPhoto(url);void recognizePhoto(url,request)}
 function capture(){const frame=video.current;if(!frame?.videoWidth)return;try{const target=box.current,crop=comicGuideCrop(frame.videoWidth,frame.videoHeight,target?.clientWidth||frame.videoWidth,target?.clientHeight||frame.videoHeight),{canvas}=canvasFor(frame,frame.videoWidth,frame.videoHeight,1500,crop),request=cancel();reset();saveFrame(canvas,request);void analyze(canvas,request,'upload')}catch{setError('This frame could not be captured. Try an uploaded photo.')}}
 function retryPhoto(){if(!previewRef.current)return;const request=cancel();reset();void recognizePhoto(previewRef.current,request)}
 function chooseCandidate(issue:Issue|null){if(!issue){setSelected(null);return}const request=cancel();setReading(false);showMatch(issue,'manual',request)}
 async function enhancePhoto(){
  if(!previewRef.current||reading)return;const request=cancel();setReading(true);setError('');setStatus('scanning');setHint('Reading the cover with enhanced vision…');const abort=new AbortController();controller.current=abort;
  try{
   const image=new Image();image.src=previewRef.current;await image.decode();if(!current(request))return;
   const {canvas}=canvasFor(image,image.naturalWidth,image.naturalHeight,1200),blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Could not prepare the photo.')),'image/jpeg',.85));
   if(!current(request))return;const form=new FormData();form.set('image',blob,'cover.jpg');form.set('consent','true');
   const response=await fetch('/api/recognition/vision',{method:'POST',body:form,signal:abort.signal}),data=await response.json();if(!current(request))return;
   if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Enhanced recognition could not finish.');
   const identity=data.identity;if(!identity||identity.uncertain||typeof identity.title!=='string'||typeof identity.number!=='string'){setStatus('unknown');setHint('Enhanced vision could not read a reliable title and issue. Choose a closer, glare-free photo.');return}
   const hints=extractCoverTextHints(identity.title+' #'+identity.number+(identity.originalSeriesYear?' ('+identity.originalSeriesYear+')':''),[{text:identity.title,confidence:100,height:100}]);
   setFinder(hints.queries[0]||identity.title);setStatus('checking_directory');const result=await lookupCoverText(hints,fetch,abort.signal);if(!current(request))return;setCandidates(result.candidates);
   if(result.match)showMatch(result.match,'text',request);else{setStatus('unknown');setHint(result.empty?'The title read from the photo has no result in the loaded directory. Check the reading or add the missing comic manually.':'The cover identifies these catalog candidates. Choose the correct year and edition.');setManualOpen(!result.candidates.length)}
  }catch(problem){if(current(request)){setStatus('unknown');setError(problem instanceof Error?problem.message:'Enhanced recognition could not finish.')}}
  finally{if(current(request)){controller.current=null;setReading(false)}}
 }
 async function confirmIssue(action:'collect'|'open'|'buy'){
  if(!selected||reading)return;const chosen=selected,request=cancel(),abort=new AbortController();controller.current=abort;setReading(true);setStatus('checking_directory');setError('');
  const verified=await resolveRecognizedIssue({catalogId:chosen.id,title:chosen.title,number:chosen.number,publisher:chosen.publisher,year:chosen.year} as Parameters<typeof resolveRecognizedIssue>[0],fetch,abort.signal);
  if(!current(request)||abort.signal.aborted)return;controller.current=null;setReading(false);
  if(verified.status!=='matched'){setStatus('index_unavailable');setError('The catalog record could not be verified. Retry or choose the issue again.');return}
  onClose();if(action==='collect')onCollect(verified.issue);else if(action==='buy'&&onBuy)onBuy(verified.issue);else onOpen(verified.issue);
 }
 const guideHeight=Math.min(viewport.height*.82,viewport.width*.82/.70),guideWidth=guideHeight*.70;
 return <div className="form-dialog comic-scan">
  <div className="eyebrow"><ScanLine size={15}/> COMIC LENS</div><h2>POINT. SCAN.<br/><span>DISCOVER.</span></h2><p>Present one cover to the camera or upload a photo. Cover fingerprints and automatic text reading search the central catalog.</p>
  <div ref={box} className={'scan-capture'+(camera?' live':'')+(preview&&!camera?' has-photo':'')+(dragging?' is-dragging':'')} onDragOver={event=>{event.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);const file=event.dataTransfer.files[0];if(file)choosePhoto(file)}}>
   {camera?<video ref={video} autoPlay muted playsInline aria-label="Live comic cover scanner" onClick={()=>{void video.current?.play().then(()=>schedule(generation.current,100))}}/>:preview?<img src={preview} alt="Your comic photo, kept on this device"/>:<div className="scan-empty"><ScanLine size={48}/><strong>YOUR NEXT FIND.<br/>RIGHT IN THE FRAME.</strong><span>Camera • Photo • Drag &amp; drop</span></div>}
   {camera&&<div className="scan-guide" aria-hidden="true" style={guideHeight>0?{width:guideWidth,height:guideHeight}:undefined}><span className="scan-corner scan-tl"/><span className="scan-corner scan-tr"/><span className="scan-corner scan-bl"/><span className="scan-corner scan-br"/><span className="scan-guide-label">ONE COVER · HOLD STEADY</span></div>}
   <span className={'scan-status-badge '+status}>{reading?<LoaderCircle size={13} className="scan-spin"/>:status==='matched'?<Check size={13}/>:<ScanLine size={13}/>} {labels[status]}</span>
  </div>
  <div className="actions">{camera?<><button type="button" className="button red" onClick={capture}><Camera size={17}/> Use this frame</button><button type="button" className="button outline" onClick={()=>{cancel();setReading(false);setStatus('idle')}}><Square size={14}/> Stop camera</button></>:<button type="button" className="button red" disabled={status==='starting'} onClick={()=>void startCamera()}><Camera size={17}/> Start camera</button>}<label className="button outline scan-upload"><ImagePlus size={17}/> Upload Image<input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)choosePhoto(file)}}/></label></div>
  {error&&<p role="alert" className="scan-error">{error}</p>}<p role="status" aria-live="polite" className="scan-hint">{hint||'Automatic OCR can find catalog books even when their cover is not in the visual index. The first text scan downloads the on-device reading model.'}</p>
  {selected&&<div className="scan-confirm"><ComicCover src={selected.cover} title={selected.title} issue={selected.number}/><div><span className="scan-match-label"><Check size={15}/> MATCH FOUND{method==='text'?' · COVER TEXT':method==='visual'?' · COVER FEATURES':' · SELECTED EDITION'}</span><strong>Match Found: {selected.title} #{selected.number}{selected.year?' ('+selected.year+')':''}</strong><p>{selected.publisher} · {selected.variant}</p><small>Confirm your printing and variant. Matching does not authenticate, grade or detect a counterfeit.</small></div><div className="actions"><button type="button" className="button red" disabled={reading} onClick={()=>void confirmIssue('collect')}>Add to shelf</button><button type="button" className="button outline" disabled={reading} onClick={()=>void confirmIssue('open')}>View FMV &amp; info</button>{onBuy&&<button type="button" className="button outline" disabled={reading} onClick={()=>void confirmIssue('buy')}><ShoppingBag size={15}/> Find copies to buy</button>}</div></div>}
  {candidates.length>0&&<div className="scan-candidates"><h3>Confirm the matching edition</h3>{candidates.map(issue=><button type="button" key={issue.id} aria-pressed={selected?.id===issue.id} onClick={()=>chooseCandidate(issue)}><span><strong>{issue.title} #{issue.number}</strong><small>{issue.year||'Date pending'} · {issue.publisher} · {issue.variant}</small></span><Check size={16}/></button>)}</div>}
  <div className="scan-secondary"><button type="button" className="scan-manual-toggle" aria-expanded={manualOpen} onClick={()=>setManualOpen(value=>!value)}><Search size={16}/> {manualOpen?'Hide directory search':'Search directory manually'}</button>{preview&&!camera&&<button type="button" disabled={reading} onClick={retryPhoto}>Retry photo &amp; text</button>}</div>
  {preview&&!camera&&!selected&&<div className="scan-enhanced"><button type="button" className="button outline" disabled={reading||!visionSetup?.available} onClick={()=>void enhancePhoto()}><ScanLine size={17}/> Enhance cover recognition</button><p>{visionSetup?.available?'Use AI for stylized lettering or glare. This sends only this cover image to Vercel AI Gateway / OpenAI; ComicHuddle does not store the photo.':visionSetup?.reason||'Checking enhanced recognition…'}</p></div>}
  {manualOpen&&<ComicPicker key={finder} value={selected} initialQuery={finder} onChange={chooseCandidate}/>}
  <p className="scan-privacy"><ShieldCheck size={15}/> Standard scan photos stay on your device. Search text and numerical fingerprints go to ComicHuddle. Enhanced recognition sends a cover image to the named AI processor only when you choose it.</p><p className="data-caption">Visual matching needs an indexed cover. Text search can identify additional books; variant and printing confirmation remain yours. JPEG, PNG or WebP up to 10 MB.</p>
 </div>;
}
