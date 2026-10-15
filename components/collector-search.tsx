'use client';
import {Search} from 'lucide-react';

/** One input geometry for marketplace and workshop searches. */
export default function CollectorSearch({value,onChange,label,placeholder,maxLength=160}:{value:string;onChange:(value:string)=>void;label:string;placeholder:string;maxLength?:number}){
 return <div className="collector-search"><Search size={18} aria-hidden="true"/><input type="search" value={value} onChange={event=>onChange(event.target.value)} aria-label={label} placeholder={placeholder} maxLength={maxLength}/></div>;
}
