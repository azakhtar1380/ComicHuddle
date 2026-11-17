'use client';
// One sheet for quick edits: a bottom sheet on phones, a centered dialog on desktop. Focus is trapped, Escape and
// a backdrop tap close it, and the shared scroll lock (lib/dialog-focus.ts) is released on close and unmount.
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {activateDialog} from '../lib/dialog-focus';
import './sheet.css';

export default function Sheet({title,onClose,children,footer}:{title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose),id=useId();
 useEffect(()=>{close.current=onClose});
 useEffect(()=>activateDialog(ref.current,()=>close.current()),[]);
 return <div className="sh-backdrop" onClick={onClose}>
  <div ref={ref} className="sh" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onClick={e=>e.stopPropagation()}>
   <span className="sh-grip" aria-hidden="true"/>
   <div className="sh-head"><h2 id={id}>{title}</h2><button type="button" className="sh-close" aria-label={'Close '+title} onClick={onClose}><X size={22} aria-hidden="true"/></button></div>
   <div className="sh-body">{children}</div>
   {footer&&<div className="sh-foot">{footer}</div>}
  </div>
 </div>;
}
