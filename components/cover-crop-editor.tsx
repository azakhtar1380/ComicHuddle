'use client';

import {useEffect,useId,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {Crop,LoaderCircle,RotateCcw} from 'lucide-react';

type Rect={x:number;y:number;width:number;height:number};
type Mode='move'|'nw'|'ne'|'sw'|'se';
const fullFrame:Rect={x:0,y:0,width:1,height:1};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Cropping happens on the device. It changes neither the catalog nor a reference image. */
export default function CoverCropEditor({src,onApply,onCancel}:{src:string;onApply:(blob:Blob)=>void;onCancel:()=>void}){
 const id=useId(),frame=useRef<HTMLDivElement>(null),photo=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement>(null),alive=useRef(true);
 const drag=useRef<{pointer:number;mode:Mode;x:number;y:number;rect:Rect}|null>(null);
 const [bounds,setBounds]=useState({width:0,height:0}),[natural,setNatural]=useState({width:1,height:1}),[rect,setRect]=useState<Rect>(fullFrame),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;const target=frame.current;if(!target)return;const resize=()=>setBounds({width:Math.max(1,target.clientWidth-32),height:Math.max(1,target.clientHeight-32)});resize();const observer=new ResizeObserver(resize);observer.observe(target);return()=>{alive.current=false;observer.disconnect();drag.current=null}},[]);
 const scale=Math.min(bounds.width/natural.width,bounds.height/natural.height),width=natural.width*scale,height=natural.height*scale;
 function start(event:ReactPointerEvent<HTMLElement>,mode:Mode){
  if(pending||!photo.current)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
  drag.current={pointer:event.pointerId,mode,x:event.clientX,y:event.clientY,rect:{...rect}};
 }
 function move(event:ReactPointerEvent<HTMLElement>){
  const active=drag.current,area=photo.current?.getBoundingClientRect();if(!active||active.pointer!==event.pointerId||!area?.width||!area.height)return;
  const dx=(event.clientX-active.x)/area.width,dy=(event.clientY-active.y)/area.height,previous=active.rect;
  if(active.mode==='move'){setRect({...previous,x:clamp(previous.x+dx,0,1-previous.width),y:clamp(previous.y+dy,0,1-previous.height)});return}
  const west=active.mode.endsWith('w'),north=active.mode.startsWith('n');
  const left=west?clamp(previous.x+dx,0,previous.x+previous.width-.06):previous.x;
  const top=north?clamp(previous.y+dy,0,previous.y+previous.height-.06):previous.y;
  const right=west?previous.x+previous.width:clamp(previous.x+previous.width+dx,previous.x+.06,1);
  const bottom=north?previous.y+previous.height:clamp(previous.y+previous.height+dy,previous.y+.06,1);
  setRect({x:left,y:top,width:right-left,height:bottom-top});
 }
 async function apply(){
  const source=image.current;if(pending||!source?.complete||!source.naturalWidth)return;setPending(true);setError('');
  try{
   const sourceWidth=source.naturalWidth*rect.width,sourceHeight=source.naturalHeight*rect.height;
   if(sourceWidth<32||sourceHeight<32)throw Error('Include a larger area of the cover.');
   const factor=Math.min(1,1500/Math.max(sourceWidth,sourceHeight)),canvas=document.createElement('canvas');
   canvas.width=Math.max(2,Math.round(sourceWidth*factor));canvas.height=Math.max(2,Math.round(sourceHeight*factor));
   const context=canvas.getContext('2d');if(!context)throw Error('This browser could not prepare the crop.');
   context.drawImage(source,source.naturalWidth*rect.x,source.naturalHeight*rect.y,sourceWidth,sourceHeight,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('The crop could not be prepared.')),'image/jpeg',.92));
   if(alive.current)onApply(blob);
  }catch(problem){if(alive.current)setError(problem instanceof Error?problem.message:'The crop could not be prepared.')}
  finally{if(alive.current)setPending(false)}
 }
 return <section className="scan-crop-editor" aria-labelledby={id+'-title'}>
  <h3 id={id+'-title'}><Crop size={18}/> Frame the cover</h3>
  <p id={id+'-help'}>Drag the corners around the comic, leaving out the slab border, background and screen text. Keep the title and issue box inside.</p>
  <div ref={frame} className="scan-crop-stage">
   <div ref={photo} className="scan-crop-photo" style={{width,height}} onPointerMove={move} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
    <img ref={image} src={src} alt="Your photo with an adjustable cover frame" draggable={false} onLoad={event=>setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}/>
    <div className="scan-crop-selection" role="group" tabIndex={0} aria-label="Cover crop frame" aria-describedby={id+'-help '+id+'-keys'} style={{left:rect.x*100+'%',top:rect.y*100+'%',width:rect.width*100+'%',height:rect.height*100+'%'}} onPointerDown={event=>start(event,'move')} onKeyDown={event=>{
     const delta=({ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]} as Record<string,number[]>)[event.key];if(!delta||pending)return;event.preventDefault();
     setRect(previous=>event.shiftKey?{...previous,width:clamp(previous.width+delta[0],.06,1-previous.x),height:clamp(previous.height+delta[1],.06,1-previous.y)}:{...previous,x:clamp(previous.x+delta[0],0,1-previous.width),y:clamp(previous.y+delta[1],0,1-previous.height)});
    }}>
     {(['nw','ne','sw','se'] as const).map(corner=><span key={corner} className={'scan-crop-handle '+corner} aria-hidden="true" onPointerDown={event=>start(event,corner)}/>)}
    </div>
   </div>
  </div>
  <small id={id+'-keys'}>Keyboard: focus the frame, then use arrow keys to move; Shift + arrows resizes.</small>
  {error&&<p role="alert" className="scan-error">{error}</p>}
  <div className="actions"><button type="button" className="button red" disabled={pending||!width} onClick={()=>void apply()}>{pending?<LoaderCircle size={16} className="scan-spin"/>:<Crop size={16}/>} Scan framed cover</button><button type="button" className="button outline" disabled={pending} onClick={()=>setRect(fullFrame)} aria-label="Reset cover crop"><RotateCcw size={15}/></button><button type="button" className="button outline" disabled={pending} onClick={onCancel}>Cancel</button></div>
 </section>;
}
