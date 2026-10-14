'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {MapPin,Search,X} from 'lucide-react';
type City={zip:string;city:string;state:string};
const label=(city:City)=>`${city.city}, ${city.state} · ${city.zip}`;
export default function LocationRadiusFilter({location,radius,onChange}:{location:string;radius:string;onChange:(location:string,radius:string)=>void}){
 const id=useId(),[input,setInput]=useState(location),[error,setError]=useState(''),[choices,setChoices]=useState<City[]>([]),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const selected=useRef<City|null>(null);
 useEffect(()=>{setInput(location);selected.current=null},[location]);
 useEffect(()=>{
  const abort=new AbortController();if(input.trim().length<2){setChoices([]);setLoading(false);return}
  const timer=setTimeout(()=>{setLoading(true);void fetch('/api/locations?q='+encodeURIComponent(selected.current?.zip||input.trim()),{signal:abort.signal}).then(async response=>{if(!response.ok)throw Error();const body=await response.json();if(!Array.isArray(body.choices))throw Error();return body.choices.filter((choice:City)=>/^\d{5}$/.test(choice.zip)&&!!choice.city&&/^[A-Z]{2}$/.test(choice.state)) as City[]}).then(next=>{if(!abort.signal.aborted){setChoices(next);setActive(-1);setError('')}}).catch(()=>{if(!abort.signal.aborted){setChoices([]);setError('City search could not connect. Retry or clear the location.')}}).finally(()=>{if(!abort.signal.aborted)setLoading(false)})},220);
  return()=>{clearTimeout(timer);abort.abort()};
 },[input,retry]);
 function choose(city:City){selected.current=city;setInput(label(city));setOpen(false);setError('');onChange(city.zip,radius)}
 function apply(nextRadius=radius){
  const value=input.trim();if(!value&&nextRadius==='nationwide'){setError('');onChange('',nextRadius);return}
  const choice=selected.current||choices.find(city=>city.zip===value||label(city).toLowerCase()===value.toLowerCase());
  if(!choice){setOpen(true);setError('Select a valid US city or ZIP code from the suggestions.');return}
  selected.current=choice;setError('');setOpen(false);onChange(choice.zip,nextRadius);
 }
 return <div className="location-radius"><div className="location-city-combobox"><label htmlFor={id}><MapPin size={14}/> City or ZIP code</label><div className="location-input-row"><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id+'-choices'} aria-activedescendant={active>=0?id+'-'+active:undefined} value={input} placeholder="Search US city or ZIP…" maxLength={100} aria-invalid={!!error} aria-describedby={error?id+'-error':undefined} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)} onChange={event=>{selected.current=null;setInput(event.target.value);setError('');setOpen(true)}} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setActive(value=>Math.min(value+1,choices.length-1))}if(event.key==='ArrowUp'){event.preventDefault();setActive(value=>Math.max(0,value-1))}if(event.key==='Enter'){event.preventDefault();if(open&&active>=0&&choices[active])choose(choices[active]);else apply()}}}/><button type="button" aria-label="Apply location search" onClick={()=>apply()}><Search size={18}/></button></div>
  {open&&input.trim().length>=2&&<div role="listbox" id={id+'-choices'} className="location-options" aria-label="US city and ZIP suggestions">{loading?<p role="status">Finding US cities…</p>:choices.length?choices.map((city,index)=><button type="button" role="option" id={id+'-'+index} aria-selected={active===index} key={city.zip} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(city)}><MapPin size={15}/><span><strong>{city.city}, {city.state}</strong><small>ZIP {city.zip}</small></span></button>):<p>{error?'Search unavailable.':'No matching US city or ZIP code.'}</p>}</div>}
 </div><label><span>Distance radius</span><select value={radius} onChange={event=>apply(event.target.value)}><option value="nationwide">Nationwide</option>{[5,15,30,50].map(value=><option key={value} value={value}>{value} miles</option>)}</select></label>{error&&<p className="location-validation" id={id+'-error'} role="alert">{error}{error.includes('connect')&&<button type="button" className="inline-button" onClick={()=>setRetry(value=>value+1)}>Retry cities</button>}</p>}<div className="location-filter-footer"><small>Approximate ZIP-level distances · <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></small>{(input||location||radius!=='nationwide')&&<button type="button" className="inline-button" onClick={()=>{selected.current=null;setInput('');setError('');setOpen(false);onChange('','nationwide')}}><X size={12}/> Clear location</button>}</div></div>;
}
