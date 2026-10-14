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
