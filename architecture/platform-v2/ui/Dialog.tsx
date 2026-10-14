'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {activateDialog} from '../../../lib/dialog-focus';
export default function Dialog({children,label,onClose}:{children:ReactNode;label:string;onClose:()=>void}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>activateDialog(ref.current,()=>close.current()),[]);
 return <div className="platform-v2 fixed inset-0 z-[100] grid items-center overflow-y-auto bg-slate-900/60 p-4" onClick={onClose}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} onClick={e=>e.stopPropagation()} className="relative mx-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-[#faf8f2] p-6 shadow-2xl"><button type="button" onClick={onClose} aria-label={'Close '+label} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white"><X size={19}/></button>{children}</div></div>;
}
