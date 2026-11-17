'use client';
// Admin: a member's display name / @handle changes. Look up by handle, reset their change counts, or rename their
// handle (for example after impersonation). Both are logged in the audit log and the member is notified.
import {useState} from 'react';

type Lookup={member:{handle:string;name:string};used:{name:number;handle:number}|null;history:{kind:string;from:string;to:string;at:string}[]};
export default function MemberNamesPanel(){
 const [handle,setHandle]=useState(''),[data,setData]=useState<Lookup|null>(null),[newHandle,setNewHandle]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function look(h=handle){setBusy(true);setMessage('');try{const r=await fetch('/api/admin/names?handle='+encodeURIComponent(h.replace(/^@/,'')),{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);setData(d)}catch(e){setData(null);setMessage(e instanceof Error?e.message:'Lookup failed.')}finally{setBusy(false)}}
 async function act(body:Record<string,string>,done:string){setBusy(true);setMessage('');try{const r=await fetch('/api/admin/names',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);setMessage(done);await look(d.handle||body.handle)}catch(e){setMessage(e instanceof Error?e.message:'That didn’t work.')}finally{setBusy(false)}}
 return <div className="adm-names">
  <form onSubmit={e=>{e.preventDefault();void look()}} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}}>
   <label className="ds-field" style={{margin:0}}><span>Member handle</span><input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="@handle" autoCapitalize="none" spellCheck={false} required/></label>
   <button type="submit" className="ds-btn ds-btn-secondary" disabled={busy}>Look up</button>
  </form>
  {message&&<p role="status" style={{margin:'10px 0 0',fontWeight:700}}>{message}</p>}
  {data&&<div style={{marginTop:12}}>
   <p style={{margin:0}}><b>{data.member.name}</b> @{data.member.handle} · {data.used?`${data.used.name} of 2 name changes, ${data.used.handle} of 2 handle changes used`:'Migration 058 isn’t applied yet.'}</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
    <button type="button" className="ds-btn ds-btn-secondary" disabled={busy||!data.used} onClick={()=>{if(window.confirm(`Reset @${data.member.handle}'s name and handle changes to 2 each?`))void act({action:'reset',handle:data.member.handle},'Changes reset. The member was notified.')}}>Reset change counts</button>
    <label className="ds-field" style={{margin:0}}><span>New handle</span><input value={newHandle} onChange={e=>setNewHandle(e.target.value.toLowerCase())} pattern="[a-z][a-z0-9_]{2,23}" placeholder="new_handle" autoCapitalize="none" spellCheck={false}/></label>
    <button type="button" className="ds-btn ds-btn-primary" disabled={busy||!/^[a-z][a-z0-9_]{2,23}$/.test(newHandle)} onClick={()=>{if(window.confirm(`Rename @${data.member.handle} to @${newHandle}? The old handle redirects for 90 days.`))void act({action:'rename',handle:data.member.handle,newHandle},'Handle changed. The member was notified.')}}>Rename handle</button>
   </div>
   {data.history.length>0&&<ul className="adm-list" style={{marginTop:10}}>{data.history.map(h=><li key={h.at+h.kind}>{new Date(h.at).toLocaleDateString('en-US')} · {h.kind}: “{h.from}” → “{h.to}”</li>)}</ul>}
  </div>}
 </div>;
}
