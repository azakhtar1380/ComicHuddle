'use client';
import {useEffect,useRef,useState} from 'react';
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export function useAppInstall(){
 const pending=useRef<InstallEvent|null>(null);
 const [installed,setInstalled]=useState(false),[instructions,setInstructions]=useState(false);
 useEffect(()=>{
  const update=()=>{const standalone=window.matchMedia('(display-mode: standalone)').matches||!!(navigator as Navigator&{standalone?:boolean}).standalone;setInstalled(standalone);document.documentElement.dataset.appView=standalone||new URLSearchParams(window.location.search).get('view')==='app'?'true':'false'};
  update();const media=window.matchMedia('(display-mode: standalone)');media.addEventListener('change',update);
  const capture=(event:Event)=>{event.preventDefault();pending.current=event as InstallEvent};
  const complete=()=>{pending.current=null;setInstalled(true)};
  window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',complete);
  if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
  return()=>{media.removeEventListener('change',update);window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',complete)};
 },[]);
 async function install(){const event=pending.current;if(!event){setInstructions(true);return}pending.current=null;try{await event.prompt();const result=await event.userChoice;if(result.outcome==='accepted')setInstalled(true)}catch{setInstructions(true)}}
 return {installed,instructions,setInstructions,install};
}
/** Body of the "Install ComicHuddle" dialog. Render it inside the dialog that opens when `instructions` is true. */
export function InstallGuide(){
 return <div className="form-dialog install-guide">
  <p className="ds-eyebrow">Install the app</p>
  <h2>Your longbox.<br/><span>One tap away.</span></h2>
  <p>Put ComicHuddle on your home screen.</p>
  <ol className="ds-steps install-guide-steps" style={{flexDirection:'column'}}>
   <li><span><strong>iPhone:</strong> In Safari, tap Share → Add to Home Screen.</span></li>
   <li><span><strong>Android:</strong> In Chrome, open the menu → Install app.</span></li>
   <li><span><strong>Computer:</strong> In Chrome or Edge, click the install icon in the address bar.</span></li>
  </ol>
 </div>;
}
