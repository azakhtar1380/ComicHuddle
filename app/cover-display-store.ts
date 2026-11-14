'use client';
// Tiny shared state between ResolvedComicCover (what is on screen) and CoverContribution
// (add/report actions rendered outside the cover button). Per page session only.
type Shown={url:string|null;credit:string};
const shown=new Map<number,Shown>(),added=new Map<number,{url:string;credit:string}>(),removed=new Set<string>(),listeners=new Set<()=>void>();
let version=0;
const emit=()=>{version++;listeners.forEach(listener=>listener())};
export function subscribeCoverDisplay(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export const coverDisplayVersion=()=>version;
export function reportShownCover(issueId:number,value:Shown){const old=shown.get(issueId);if(old&&old.url===value.url&&old.credit===value.credit)return;shown.set(issueId,value);emit()}
export const shownCover=(issueId:number)=>shown.get(issueId)||null;
export function addSharedCover(issueId:number,cover:{url:string;credit:string}){added.set(issueId,cover);emit()}
export const sharedCover=(issueId:number)=>added.get(issueId)||null;
export function removeCoverUrl(url:string){removed.add(url);for(const [id,cover] of added)if(cover.url===url)added.delete(id);emit()}
export const coverRemoved=(url:string)=>removed.has(url);
