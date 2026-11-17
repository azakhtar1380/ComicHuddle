'use client';
// The share window is its own chunk (not in the profile page's bundle). The profile page warms it when idle and
// on hover/touch of Share; once loaded it renders in the same frame as the tap. Before that, the dialog opens at
// once with "Opening…" and fills in when the code arrives.
import {useEffect,useState,type ComponentProps} from 'react';

type Module=typeof import('./profile-share');
let pending:Promise<Module>|null=null,loaded:Module|null=null;
export function loadProfileShare(){pending??=import('./profile-share').then(m=>{loaded=m;return m});return pending}
export function warmProfileShare(){void loadProfileShare().catch(()=>{pending=null})}

export default function LazyProfileShare(props:ComponentProps<Module['default']>){
 const [mod,setMod]=useState<Module|null>(loaded);
 useEffect(()=>{if(mod)return;let keep=true;void loadProfileShare().then(m=>{if(keep)setMod(m)}).catch(()=>{pending=null});return()=>{keep=false}},[mod]);
 if(!mod)return <p className="ps-loading" role="status">Opening…</p>;
 const Share=mod.default;return <Share {...props}/>;
}
