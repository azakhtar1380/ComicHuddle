'use client';
import {useId,useState} from 'react';
import {BookOpen,Check,Search,X} from 'lucide-react';
import ComicPicker from './comic-picker';
import type {Issue} from '../lib/catalog';
import type {Vault} from '../lib/vault';
import './comic-multi-picker.css';

export type ComicChoice={id:string;title:string;issue:string;subtitle?:string;cover?:string};
function ChoiceCover({src,title}:{src?:string;title:string}){
 const [failed,setFailed]=useState<string|null>(null);
 return <span className="comic-choice-cover">{src&&failed!==src?<img src={src} alt={title+' cover'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:<BookOpen size={20}/>}</span>;
}
export function SelectedComicList({items,onRemove,disabled=false,label='Selected comics'}:{items:ComicChoice[];onRemove:(id:string)=>void;disabled?:boolean;label?:string}){
 return <div className="comic-choice-list" aria-label={label}>
  <p className="comic-choice-count" role="status">{items.length?items.length+' comic'+(items.length===1?'':'s')+' selected':'No comics selected yet. Choose a result above to add it here.'}</p>
  {items.map(item=><div className="comic-choice-row" key={item.id}><ChoiceCover src={item.cover} title={item.title}/><div><strong>{item.title} {item.issue.startsWith('#')?item.issue:'#'+item.issue}</strong>{item.subtitle&&<small>{item.subtitle}</small>}</div><button type="button" disabled={disabled} aria-label={'Remove '+item.title+' '+item.issue} onClick={()=>onRemove(item.id)}><X size={17}/></button></div>)}
 </div>;
}
export default function ComicMultiPicker({value,onChange,multiple=true,max=100,disabled=false,label='Find a comic in the directory'}:{value:Issue[];onChange:(value:Issue[])=>void;multiple?:boolean;max?:number;disabled?:boolean;label?:string}){
 const [message,setMessage]=useState('');
 function choose(issue:Issue|null){if(!issue)return;if(value.some(item=>item.id===issue.id)){setMessage('That issue is already in your list.');return}if(multiple&&value.length>=max){setMessage('Choose up to '+max+' comics for this list.');return}setMessage('');onChange(multiple?[...value,issue]:[issue]);}
 return <div className="comic-multi-picker"><ComicPicker value={null} onChange={choose} label={label} disabled={disabled} clearOnChoose/>{message&&<p className="comic-choice-message" role="status">{message}</p>}<SelectedComicList items={value.map(issue=>({id:String(issue.id),title:issue.title,issue:issue.number,subtitle:[issue.publisher,issue.year||null,issue.variant].filter(Boolean).join(' · '),cover:issue.cover}))} onRemove={id=>{setMessage('');onChange(value.filter(issue=>String(issue.id)!==id))}} disabled={disabled}/></div>;
}

/** An owned-copy picker preserves distinct physical copies of the same issue. */
export function OwnedComicPicker({books,selected,onChange,multiple,disabled=false}:{books:Vault['books'];selected:string[];onChange:(ids:string[])=>void;multiple:boolean;disabled?:boolean}){
 const id=useId(),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0),[limit,setLimit]=useState(20);
 const matches=books.filter(book=>!selected.includes(book.id)&&(book.title+' '+book.issue+' '+book.grade).toLowerCase().includes(query.toLowerCase())),rows=matches.slice(0,limit);
 function choose(key:string){onChange(multiple?[...selected,key]:[key]);setQuery('');setOpen(false);setActive(0);setLimit(20)}
 return <div className="comic-multi-picker owned-comic-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}}>
  <label htmlFor={id}>Choose from my collection</label><div className="picker-input"><Search size={18}/><input id={id} value={query} disabled={disabled} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={open?id+'-list':undefined} aria-autocomplete="list" aria-activedescendant={open&&rows[active]?id+'-'+active:undefined} placeholder="Search your owned comics…" onClick={()=>setOpen(true)} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setActive(0);setLimit(20);setOpen(true)}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false)}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(index=>Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1))))}if(event.key==='Enter'){event.preventDefault();if(open&&rows[active])choose(rows[active].id)}}}/></div>
  {open&&!disabled&&<div className="picker-dropdown"><div id={id+'-list'} role="listbox" aria-label="Owned comics to include" className="picker-results">{rows.map((book,index)=><button type="button" key={book.id} id={id+'-'+index} role="option" aria-selected={index===active} className={'owned-comic-option'+(index===active?' active':'')} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(book.id)}><span><strong>{book.title} {book.issue}</strong><small>{book.grade||'Condition not recorded'}</small></span><Check size={16}/></button>)}{!matches.length&&<p className="picker-empty">{books.length?'No additional matching copy. Change your search or add comics from the directory.':'Add a comic from the directory to start your list.'}</p>}</div>{matches.length>rows.length&&<button type="button" className="picker-load-more" onMouseDown={event=>event.preventDefault()} onClick={()=>setLimit(value=>value+20)}>Show more owned comics</button>}</div>}
  <SelectedComicList items={selected.flatMap(key=>{const book=books.find(book=>book.id===key);return book?[{id:book.id,title:book.title,issue:book.issue,subtitle:book.grade||'Condition not recorded',cover:book.photoId?'/api/media?id='+book.photoId:undefined}]:[]})} onRemove={key=>onChange(selected.filter(id=>id!==key))} disabled={disabled}/>
 </div>;
}
