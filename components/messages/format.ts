// Small, pure helpers for the inbox (times, unread, profile colours).
import type {Thread} from '../../lib/community';

export type InboxThread=Thread&{unread?:boolean;unreadCount?:number;archived?:boolean;peer:Thread['peer']&{avatarUrl?:string|null;color?:string}};

const valid=(s:string)=>{const d=new Date(s);return Number.isNaN(d.getTime())?null:d};
const sameDay=(a:Date,b:Date)=>a.toDateString()===b.toDateString();

/** Inbox row time: 3:42 PM today, "Yesterday", weekday this week, otherwise Nov 3 (or Nov 3, 2025). */
export function listStamp(s:string){
 const d=valid(s);if(!d)return '';const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
 if(sameDay(d,now))return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
 if(sameDay(d,yesterday))return 'Yesterday';
 if(now.getTime()-d.getTime()<6*86400000)return d.toLocaleDateString('en-US',{weekday:'short'});
 return d.toLocaleDateString('en-US',{month:'short',day:'numeric',...(d.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})});
}
export const timeOnly=(s:string)=>valid(s)?.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})||'';
export const fullStamp=(s:string)=>valid(s)?.toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})||'';
/** Day divider label inside a conversation. */
export function dayLabel(s:string){
 const d=valid(s);if(!d)return '';const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
 if(sameDay(d,now))return 'Today';if(sameDay(d,yesterday))return 'Yesterday';
 return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',...(d.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})});
}
export const dayKey=(s:string)=>valid(s)?.toDateString()||'';

/** Profile colour names → soft avatar backgrounds that match the showcase tones. */
export const toneColor=(c?:string)=>({red:'#f3cfc6',blue:'#cfe0e6',teal:'#cde6df',yellow:'var(--yellow)'} as Record<string,string>)[c||'']||'var(--yellow)';

export const money=(cents:number)=>'$'+(cents/100).toLocaleString('en-US',{minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2});

// Per-device fallback read markers, used only when the server has no read state (migration 035 not applied).
const seenKey='comichuddle:chat-seen';
export function readSeen():Record<string,string>{try{const v=JSON.parse(localStorage.getItem(seenKey)||'{}');return v&&typeof v==='object'?v:{}}catch{return {}}}
export function writeSeen(next:Record<string,string>){try{localStorage.setItem(seenKey,JSON.stringify(next))}catch{/* private mode */}}

/** Whether a conversation has unread messages: server read state when available, otherwise this device's markers. */
export function threadUnread(t:InboxThread,seen:Record<string,string>){
 if(typeof t.unread==='boolean')return t.unread;
 return t.latestMine===false&&!!t.latestAt&&(!seen[t.id]||seen[t.id]<t.latestAt);
}
/** Number of conversations with unread messages, for the header / More menu / dock badges. */
export function countUnread(threads:Thread[]){
 const seen=typeof window==='undefined'?{}:readSeen();
 return (threads as InboxThread[]).filter(t=>!t.archived&&threadUnread(t,seen)).length;
}
