'use client';
// The account / More drawer's open state lives outside the app shell (app/hub.tsx), so opening or closing it
// re-renders only the drawer and the two buttons that show its state, not the whole page underneath.
import {useSyncExternalStore,type ReactNode} from 'react';

export type DrawerKind='more'|'account';
type State={open:boolean;kind:DrawerKind};
let state:State={open:false,kind:'more'};
const listeners=new Set<()=>void>();
const emit=()=>{for(const l of listeners)l()};
export function setDrawer(open:boolean){if(state.open!==open){state={...state,open};emit()}}
export function setPanelKind(kind:DrawerKind){if(state.kind!==kind){state={...state,kind};emit()}}
const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l)}};
const snapshot=()=>state,serverSnapshot=()=>state;
export function useDrawer(){return useSyncExternalStore(subscribe,snapshot,serverSnapshot)}
/** Renders children(open) and re-renders on open/close only. */
export function DrawerOpen({children}:{children:(open:boolean)=>ReactNode}){return <>{children(useDrawer().open)}</>}
/** Renders the drawer only while it is open. */
export function DrawerHost({children}:{children:(kind:DrawerKind)=>ReactNode}){const d=useDrawer();return d.open?<>{children(d.kind)}</>:null}
