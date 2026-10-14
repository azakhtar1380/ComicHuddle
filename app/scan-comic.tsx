'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Check,ImagePlus,LoaderCircle,ScanLine,Search,ShieldCheck,Square} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import {safeScanImage,scanSearchText,recognizedBarcode,stopComicCamera} from '../lib/comic-scan';
import {COVER_FRAME_INTERVAL_MS,comicGuideCrop,createCoverConsensus,loadCoverIndex,lookupExactComicText,parseExactComicText,recognizeCoverPixels,resolveRecognizedIssue,type CoverIndex,type RecognitionStatus} from '../lib/cover-recognition';
import ComicPicker from './comic-picker';
import './scan-comic.css';

type LocalDetector={detect:(image:CanvasImageSource)=>Promise<{rawValue?:string}[]>};
type DetectionWindow=Window&{BarcodeDetector?:new(options:{formats:string[]})=>LocalDetector;TextDetector?:new()=>LocalDetector};
type Viewport={width:number;height:number};
const scanStatusLabels:Record<RecognitionStatus,string>={idle:'READY TO SCAN',starting:'STARTING CAMERA',scanning:'LOOKING FOR A COVER',checking_directory:'VERIFYING DIRECTORY RECORD',matched:'DIRECTORY COVER CANDIDATE',unknown:'NO CONFIDENT MATCH YET',not_in_directory:'EXACT SEARCH NOT IN DIRECTORY',index_unavailable:'RECOGNITION UNAVAILABLE',permission_denied:'CAMERA PERMISSION NEEDED'};

export default function ComicScan({onOpen,onCollect,onClose,startOnOpen=false}:{onOpen:(issue:Issue)=>void;onCollect:(issue:Issue)=>void;onClose:()=>void;startOnOpen?:boolean}){
 const video=useRef<HTMLVideoElement>(null),captureBox=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null),mounted=useRef(true),generation=useRef(0);
 const activeCamera=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),controller=useRef<AbortController|null>(null),index=useRef<CoverIndex|null>(null),consensus=useRef(createCoverConsensus()),inFlight=useRef(false),started=useRef(0),selectedRef=useRef<Issue|null>(null),previewRef=useRef('');
 const [dragging,setDragging]=useState(false),[camera,setCamera]=useState(false),[preview,setPreview]=useState(''),[reading,setReading]=useState(false),[hint,setHint]=useState(''),[error,setError]=useState(''),[selected,setSelected]=useState<Issue|null>(null),[finder,setFinder]=useState(''),[pickerVersion,setPickerVersion]=useState(0),[status,setStatus]=useState<RecognitionStatus>('idle'),[manualOpen,setManualOpen]=useState(false),[viewport,setViewport]=useState<Viewport>({width:0,height:0});

 useEffect(()=>{
  mounted.current=true;
  return()=>{mounted.current=false;generation.current++;clearTimer();controller.current?.abort();activeCamera.current=false;stopComicCamera(stream.current);stream.current=null;consensus.current.reset()};
 },[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 useEffect(()=>{
  const box=captureBox.current;if(!box)return;
  const measure=()=>{const size=box.getBoundingClientRect();setViewport({width:box.clientWidth||size.width,height:box.clientHeight||size.height})};measure();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(box);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure)};
 },[]);
 useEffect(()=>{
  if(!camera||!video.current||!stream.current)return;
  const request=generation.current,frame=video.current;frame.srcObject=stream.current;
  void frame.play().then(()=>{if(current(request)&&activeCamera.current)scheduleFrame(request,0)}).catch(()=>{if(current(request)){setError('Tap the preview to start the camera, or choose a photo.');setStatus('unknown')}});
 },[camera]);
 useEffect(()=>{
  function visibilityChanged(){
   if(document.visibilityState==='hidden'){
    generation.current++;clearTimer();controller.current?.abort();controller.current=null;consensus.current.reset();inFlight.current=false;
    stream.current?.getVideoTracks().forEach(track=>{track.enabled=false});
    if(activeCamera.current){setStatus('scanning');setHint('Camera recognition is paused while this tab is hidden.')}
    else if(selectedRef.current)setStatus('matched');
    else{setStatus('idle');setHint('Recognition is paused while this tab is hidden.');}
    setReading(false);
   }else if(activeCamera.current){
    stream.current?.getVideoTracks().forEach(track=>{track.enabled=true});started.current=performance.now();setStatus('scanning');setHint('Fill the guide with one cover and hold steady.');scheduleFrame(generation.current,0);
   }else if(previewRef.current&&!selectedRef.current){void recognizePhoto(previewRef.current,generation.current)}
   else if(!selectedRef.current){setStatus('idle');setHint('Start the camera or choose a cover photo to recognize an issue.');}
  }
  document.addEventListener('visibilitychange',visibilityChanged);
  return()=>document.removeEventListener('visibilitychange',visibilityChanged);
 },[]);
 // Opt in only from an explicit Scan opening action. Page loads/deep links keep
 // the default idle state. Cleanup also cancels StrictMode's discarded effect.
 useEffect(()=>{
  if(!startOnOpen)return;
  let cancelled=false;
  void Promise.resolve().then(()=>{if(!cancelled&&mounted.current&&document.visibilityState==='visible')void startCamera()});
  return()=>{cancelled=true};
 },[startOnOpen]);

 function current(request:number){return mounted.current&&generation.current===request}
 function clearTimer(){if(timer.current!==null)clearTimeout(timer.current);timer.current=null}
 function stopLiveMedia(){clearTimer();activeCamera.current=false;stopComicCamera(stream.current);stream.current=null;setCamera(false)}
 function cancelWork(){generation.current++;clearTimer();controller.current?.abort();controller.current=null;consensus.current.reset();inFlight.current=false;stopLiveMedia();return generation.current}
 function resetImageSelection(){selectedRef.current=null;setSelected(null);setReading(false);setFinder('');setPickerVersion(value=>value+1);setManualOpen(false)}
 function setLocalPreview(url:string){previewRef.current=url;setPreview(url)}
 function selectIssue(issue:Issue|null){cancelWork();setReading(false);selectedRef.current=issue;setSelected(issue);setStatus(issue?'matched':'idle');setHint(issue?'Directory issue selected. Confirm the edition and printing before adding a copy.':'Search for the exact title and issue.');}
 function scheduleFrame(request:number,delay=COVER_FRAME_INTERVAL_MS){
  clearTimer();
  if(!current(request)||!activeCamera.current||document.visibilityState==='hidden')return;
  timer.current=setTimeout(()=>{timer.current=null;void scanFrame(request)},delay);
 }
 async function ensureIndex(request:number){
  if(index.current)return index.current;
  const pending=new AbortController();controller.current=pending;
  const loaded=await loadCoverIndex(fetch,pending.signal);
  if(!current(request)||pending.signal.aborted)throw Error('Obsolete scan.');
  index.current=loaded;controller.current=null;return loaded;
 }
 function frameCanvas(source:CanvasImageSource,width:number,height:number,maxSide=640){
  if(width<2||height<2||!Number.isFinite(width)||!Number.isFinite(height))throw Error('The camera is still starting.');
  const scale=Math.min(1,maxSide/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(width*scale));canvas.height=Math.max(2,Math.round(height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Image reading is unavailable in this browser.');
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(source,0,0,canvas.width,canvas.height);
  return {canvas,context,pixels:context.getImageData(0,0,canvas.width,canvas.height)};
 }
 function saveCanvasPreview(canvas:HTMLCanvasElement,request:number,then?:(url:string)=>void){
  canvas.toBlob(blob=>{if(!current(request))return;if(!blob){if(then){setReading(false);setStatus('unknown');setError('This browser could not capture the photo. Try again or choose a photo.');}return}const url=URL.createObjectURL(blob);setLocalPreview(url);then?.(url)},'image/jpeg',.92);
 }
 async function startCamera(){
  const request=cancelWork();resetImageSelection();setLocalPreview('');setError('');setStatus('starting');setHint('Allow camera access to recognize covers on this device.');
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable in this browser. Choose a photo instead.');
   const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1920}},audio:false});
   if(!current(request)||document.visibilityState==='hidden'){stopComicCamera(next);return}
   stopComicCamera(stream.current);stream.current=next;activeCamera.current=true;started.current=performance.now();setCamera(true);setStatus('scanning');setHint('Fill the guide with one cover and hold steady. Matches appear automatically.');
  }catch(problem){
   if(!current(request))return;
   const denied=!!problem&&typeof problem==='object'&&'name' in problem&&['NotAllowedError','PermissionDeniedError','SecurityError'].includes(String(problem.name));
   setStatus(denied?'permission_denied':'unknown');setError(denied?'Camera permission was not granted. Allow it in your browser settings, or choose a photo.':problem instanceof Error?problem.message:'The camera could not be started. Choose a photo instead.');
  }
 }
 async function scanFrame(request:number){
  if(!current(request)||!activeCamera.current||document.visibilityState==='hidden'||inFlight.current)return;
  const frame=video.current;if(!frame?.videoWidth){scheduleFrame(request);return}
  inFlight.current=true;
  try{
   const references=await ensureIndex(request);if(!current(request)||!activeCamera.current)return;
   const {canvas,pixels}=frameCanvas(frame,frame.videoWidth,frame.videoHeight),box=captureBox.current;
   const result=recognizeCoverPixels(pixels,references,{mode:'camera',viewportWidth:box?.clientWidth||frame.videoWidth,viewportHeight:box?.clientHeight||frame.videoHeight});
   const stable=consensus.current.push(result,performance.now());
   if(stable){
    setStatus('checking_directory');setHint('Cover matched. Verifying its exact directory record…');setReading(true);
    const snapshot=document.createElement('canvas');snapshot.width=Math.round(stable.crop.width);snapshot.height=Math.round(stable.crop.height);snapshot.getContext('2d')?.drawImage(canvas,stable.crop.x,stable.crop.y,stable.crop.width,stable.crop.height,0,0,snapshot.width,snapshot.height);saveCanvasPreview(snapshot,request);
    stopLiveMedia();
    const pending=new AbortController();controller.current=pending;const verified=await resolveRecognizedIssue(stable.reference,fetch,pending.signal);
    if(!current(request)||pending.signal.aborted)return;
    controller.current=null;setStatus(verified.status);
    if(verified.status==='matched'){selectedRef.current=verified.issue;setSelected(verified.issue);setHint('Recognized '+verified.issue.title+' #'+verified.issue.number+' cover art. Confirm the edition and printing below.');}
    else setHint('This cover’s directory record could not be verified. Retry the photo or search the directory.');
   }else if(performance.now()-started.current>=4000){setStatus('unknown');setHint('No confident match yet. Fill the guide and hold steady, or search below. Automatic matching currently covers six Planet Comics covers.');}
  }catch{
   if(current(request)){stopLiveMedia();setStatus('index_unavailable');setHint('The recognition index could not be loaded or read. Retry the camera or use directory search.');}
  }finally{if(current(request)){inFlight.current=false;setReading(false);scheduleFrame(request)}}
 }
 function capture(){
  const frame=video.current;if(!frame?.videoWidth){setError('The camera is still starting. Try again in a moment.');return}
  try{
   const box=captureBox.current,crop=comicGuideCrop(frame.videoWidth,frame.videoHeight,box?.clientWidth||frame.videoWidth,box?.clientHeight||frame.videoHeight),canvas=document.createElement('canvas');
   const scale=Math.min(1,1200/Math.max(crop.width,crop.height));canvas.width=Math.max(2,Math.round(crop.width*scale));canvas.height=Math.max(2,Math.round(crop.height*scale));
   const context=canvas.getContext('2d');if(!context)throw Error('This browser could not capture the image.');context.drawImage(frame,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
   const request=cancelWork();resetImageSelection();setError('');setStatus('scanning');setReading(true);setHint('Reading this cover on your device…');saveCanvasPreview(canvas,request,url=>void recognizePhoto(url,request));
  }catch(problem){setError(problem instanceof Error?problem.message:'The photo could not be captured.');}
 }
 function choosePhoto(file:File){
  if(!safeScanImage(file)){setError('Choose a JPEG, PNG or WebP image no larger than 10 MB.');return}
  const request=cancelWork();resetImageSelection();setError('');const url=URL.createObjectURL(file);setLocalPreview(url);void recognizePhoto(url,request);
 }
 async function recognizePhoto(url:string,request:number){
  if(!current(request)||document.visibilityState==='hidden')return;
  setReading(true);setStatus('scanning');setHint('Comparing the cover with the local reference index…');
  try{
   const image=new Image();image.src=url;await image.decode();if(!current(request))return;
   const references=await ensureIndex(request);if(!current(request))return;
   const {pixels}=frameCanvas(image,image.naturalWidth,image.naturalHeight),result=recognizeCoverPixels(pixels,references,{mode:'upload'});
   if(result.status==='matched'){
    setStatus('checking_directory');setHint('Cover matched. Verifying its exact directory record…');const pending=new AbortController();controller.current=pending;
    const verified=await resolveRecognizedIssue(result.suggestion.reference,fetch,pending.signal);if(!current(request)||pending.signal.aborted)return;controller.current=null;setStatus(verified.status);
    if(verified.status==='matched'){selectedRef.current=verified.issue;setSelected(verified.issue);setHint('Recognized '+verified.issue.title+' #'+verified.issue.number+' cover art. Confirm the edition and printing below.');}
    else setHint('The cover match could not be verified against the directory. Retry or search below.');
   }else{setStatus(result.status);setHint('This photo could not be identified confidently. The local index covers six Planet Comics covers; an unmatched photo does not mean your comic is missing from the directory.');}
  }catch{if(current(request)){setStatus('index_unavailable');setHint('This photo or the local recognition index could not be read. Choose another photo or search the directory.');}}
  finally{if(current(request))setReading(false)}
 }
 function retryPhoto(){if(!previewRef.current)return;const request=cancelWork();resetImageSelection();setError('');void recognizePhoto(previewRef.current,request)}
 async function readPhoto(){
  if(!preview||reading)return;
  const request=cancelWork();setReading(true);setError('');setStatus('scanning');
  try{
   const image=new Image();image.src=preview;await image.decode();if(!current(request))return;
   const capabilities=window as DetectionWindow;let text='';
   if(capabilities.BarcodeDetector){const codes=await new capabilities.BarcodeDetector({formats:['ean_13','upc_a']}).detect(image);text=codes.map(code=>recognizedBarcode(code.rawValue||'')).find(Boolean)||'';}
   if(!text&&capabilities.TextDetector){const words=await new capabilities.TextDetector().detect(image);text=scanSearchText(words.map(word=>word.rawValue||'').join(' '));}
   if(!current(request))return;
   if(text){
    setFinder(text);setManualOpen(true);const exact=parseExactComicText(text);
    if(exact){
     setStatus('checking_directory');const pending=new AbortController();controller.current=pending;const lookup=await lookupExactComicText(exact,fetch,pending.signal);if(!current(request)||pending.signal.aborted)return;controller.current=null;setStatus(lookup.status);
     if(lookup.status==='matched'){selectedRef.current=lookup.issue;setSelected(lookup.issue);setHint('Read '+text+'. Directory record found; confirm its edition and printing.');}
     else if(lookup.status==='not_in_directory')setHint('Read '+text+'. That exact title and issue search returned no directory records. Check the reading or search below.');
     else setHint('Read '+text+'. The exact record could not be verified. Check the reading and choose the directory issue below.');
    }else{setStatus('unknown');setHint('Read: '+text+'. Use this search hint below; confirm title, year, variant and printing before saving.');}
   }else{setStatus('unknown');setHint('No readable barcode or text was found with this browser. Search the title and issue below.');setManualOpen(true);}
  }catch{if(current(request)){setStatus('unknown');setError('This browser could not read the barcode or text. Search the title and issue below.');setManualOpen(true);}}
  finally{if(current(request))setReading(false)}
 }
 async function confirmIssue(action:'collect'|'open'){
  if(!selected||reading)return;
  const chosen=selected,request=cancelWork();setReading(true);setStatus('checking_directory');setError('');const pending=new AbortController();controller.current=pending;
  const verified=await resolveRecognizedIssue({catalogId:chosen.id,title:chosen.title,number:chosen.number,publisher:chosen.publisher,year:chosen.year} as Parameters<typeof resolveRecognizedIssue>[0],fetch,pending.signal);
  if(!current(request)||pending.signal.aborted)return;
  controller.current=null;setReading(false);
  if(verified.status!=='matched'){selectedRef.current=null;setSelected(null);setStatus('index_unavailable');setError('The directory record could not be verified. Retry the scan or choose the issue again.');return}
  setStatus('matched');onClose();if(action==='collect')onCollect(verified.issue);else onOpen(verified.issue);
 }
 const guideHeight=Math.min(viewport.height*.82,viewport.width*.82/.70),guideWidth=guideHeight*.70;
 return <div className="form-dialog comic-scan">
  <div className="eyebrow"><ScanLine size={15}/> SCAN YOUR COMIC</div><h2>POINT. SCAN.<br/><span>DISCOVER.</span></h2>
  <p>Point your camera at one cover. A directory match appears automatically when the cover is recognized. Confirm its edition and printing before adding a copy.</p>
  <div className={'scan-capture'+(camera?' live':'')+(preview&&!camera?' has-photo':'')+(dragging?' is-dragging':'')} ref={captureBox} onDragOver={event=>{event.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);const file=event.dataTransfer.files?.[0];if(file)choosePhoto(file)}}>
   {camera?<video ref={video} autoPlay muted playsInline aria-label="Live rear camera cover scanner" onClick={()=>{const request=generation.current;void video.current?.play().then(()=>scheduleFrame(request,0)).catch(()=>{if(current(request))setError('The camera preview could not be started. Choose a photo instead.');})}}/>:preview?<img src={preview} alt="Your comic photo, kept only on this device"/>:<div className="scan-empty"><ScanLine size={48}/><strong>PUT YOUR NEXT FIND<br/>IN THE FRAME.</strong><span>Start the camera or drop a cover image here</span></div>}
   {camera&&<div className="scan-guide" aria-hidden="true" style={guideHeight>0?{width:guideWidth,height:guideHeight}:undefined}><span className="scan-corner scan-tl"/><span className="scan-corner scan-tr"/><span className="scan-corner scan-bl"/><span className="scan-corner scan-br"/><span className="scan-guide-label">ALIGN COVER · HOLD STEADY</span></div>}
   <span className={'scan-status-badge '+status}>{reading?<LoaderCircle size={13} className="scan-spin"/>:status==='matched'?<Check size={13}/>:<ScanLine size={13}/>} {scanStatusLabels[status]}</span>
  </div>
  <div className="actions">
   {camera?<><button type="button" className="button red" onClick={capture}><Camera size={17}/> Use this frame</button><button type="button" className="button outline" onClick={()=>{cancelWork();setReading(false);setStatus('idle');setHint('Camera stopped. Start it again or choose a photo.')}}><Square size={14}/> Stop camera</button></>:<button type="button" className="button red" disabled={status==='starting'} onClick={()=>void startCamera()}><Camera size={17}/> {status==='starting'?'Starting camera…':'Start camera'}</button>}
   <label className="button outline scan-upload"><ImagePlus size={17}/> Upload Image<input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)choosePhoto(file)}}/></label>
  </div>
  {error&&<p role="alert" className="scan-error">{error}</p>}
  <p role="status" aria-live="polite" className="scan-hint">{hint||'Automatic cover matching currently supports Planet Comics #12, #21, #27, #42, #53 and #55. Other comics can be found with directory search.'}</p>
  {selected&&<div className="scan-confirm">{selected.cover&&<img src={selected.cover} alt={selected.title+' #'+selected.number+' directory cover'}/>}<div><span className="scan-match-label"><Check size={15}/> DIRECTORY CANDIDATE · CONFIRM PRINTING</span><strong>{selected.title} #{selected.number}</strong><p>{selected.year} · {selected.publisher}<br/>{selected.variant}</p><small>The same cover art can be reprinted. Confirm your edition; recognition does not determine grade, condition or printing.</small></div><div className="actions"><button type="button" className="button red" disabled={reading} onClick={()=>void confirmIssue('collect')}>Confirm &amp; add</button><button type="button" className="button outline" disabled={reading} onClick={()=>void confirmIssue('open')}>View issue</button></div>{selected.coverCredit&&<small className="scan-match-credit">{selected.coverCredit}</small>}</div>}
  <div className="scan-secondary"><button type="button" className="scan-manual-toggle" aria-expanded={manualOpen} onClick={()=>setManualOpen(value=>!value)}><Search size={16}/> {manualOpen?'Hide directory search':'Search directory manually'}</button>{preview&&!camera&&!selected&&<><button type="button" disabled={reading} onClick={retryPhoto}>Retry cover match</button><button type="button" disabled={reading} onClick={()=>void readPhoto()}>Read barcode / text</button></>}</div>
  {manualOpen&&<ComicPicker key={finder+'|'+pickerVersion} value={selected} initialQuery={finder} onChange={selectIssue}/>}
  <p className="scan-privacy"><ShieldCheck size={15}/> Photos and camera frames stay on your device. This scanner does not upload them.</p>
  <p className="data-caption">Local reference coverage: 6 covers. No confident match means unknown, even if the comic exists in the directory. JPEG, PNG or WebP photos up to 10 MB. Barcode/text reading depends on browser support.</p>
 </div>;
}
