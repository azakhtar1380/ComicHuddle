'use client';
import {useState} from 'react';
import EstimatedValue from './estimated-value';
export default function IssueValues({issueId,researchUrl}:{issueId:number;researchUrl:string}){
 const [format,setFormat]=useState<'Raw'|'CGC'>('Raw'),[grade,setGrade]=useState('8.0');
 return <section className="issue-market-values" aria-label="Issue estimated market values"><div className="issue-value-controls"><label>Reference format<select value={format} onChange={event=>{setFormat(event.target.value as 'Raw'|'CGC');setGrade(event.target.value==='Raw'?'8.0':'9.8')}}><option>Raw</option><option>CGC</option></select></label><label>Reference condition<select value={grade} onChange={event=>setGrade(event.target.value)}>{['9.8','9.6','9.4','9.2','9.0','8.0','6.0'].map(value=><option key={value}>{value}</option>)}</select></label></div><EstimatedValue detail request={{issueId,reference:true,condition:{mode:format,grade,label:format==='Raw'?'Raw':'Universal',printing:'Catalog edition'}}}/><a className="inline-button" href={researchUrl} target="_blank" rel="noreferrer">Explore GoCollect independently ↗</a></section>;
}
