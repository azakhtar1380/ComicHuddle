'use client';
// "Add comics": Search the Directory (pick up to 50, set each one's condition, add them in one save) or Scan.
// Duplicates are allowed (people own several copies); a picked issue shows "You already have 1".
import {useState} from 'react';
import {Camera,Search} from 'lucide-react';
import Sheet from '../sheet';
import ComicMultiPicker from '../../app/comic-multi-picker';
import type {Issue} from '../../lib/catalog';
import type {Vault} from '../../lib/vault';
import {issueIdentity,listingDirectoryId} from '../../lib/shared-catalog';
import {quickGrades} from '../../lib/listing-grades';

const MAX_PICK=50,VAULT_CAP=1000;
export default function AddComicsSheet({vault,commit,onClose,onScan,notice}:{vault:Vault;commit:(v:Vault)=>Promise<boolean>;onClose:()=>void;onScan:()=>void;notice:(s:string)=>void}){
 const [step,setStep]=useState<'choose'|'search'>('choose'),[picked,setPicked]=useState<Issue[]>([]),[grades,setGrades]=useState<Record<number,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const room=Math.max(0,VAULT_CAP-vault.books.length);
 const owned=(id:number)=>vault.books.filter(b=>listingDirectoryId(b)===id||b.catalogId===id).length;
 async function add(){
  if(!picked.length||busy)return;
  if(picked.length>room){setError(room?`Your collection can hold ${VAULT_CAP.toLocaleString('en-US')} comics. You have room for ${room} more.`:`Your collection is full (${VAULT_CAP.toLocaleString('en-US')} comics). Remove some to add more.`);return}
  setBusy(true);setError('');
  const copies=picked.map(issue=>({id:crypto.randomUUID(),...issueIdentity(issue),title:issue.title,issue:'#'+issue.number.replace(/^#/,''),grade:grades[issue.id]||'Raw',price:0}));
  try{if(await commit({...vault,books:[...vault.books,...copies]})){notice(`Added ${copies.length} ${copies.length===1?'comic':'comics'}`);onClose()}else setError('We’re not sure that saved. Your picks are still here. Try again.')}
  catch{setError('Couldn’t save. Your picks are still here. Try again.')}finally{setBusy(false)}
 }
 if(step==='choose')return <Sheet title="Add comics" onClose={onClose}>
  <div className="ac2-choices">
   <button type="button" className="ac2-choice" onClick={()=>setStep('search')}><Search size={26} aria-hidden="true"/><span><strong>Search the Directory</strong><small>Pick several comics at once</small></span></button>
   <button type="button" className="ac2-choice" onClick={onScan}><Camera size={26} aria-hidden="true"/><span><strong>Scan</strong><small>Use your camera on a cover</small></span></button>
  </div>
  {room<=0&&<p className="ds-error" role="alert">Your collection is full ({VAULT_CAP.toLocaleString('en-US')} comics).</p>}
 </Sheet>;
 return <Sheet title="Search the Directory" onClose={onClose} footer={<>
  {error&&<p className="ds-error ac2-error" role="alert">{error}</p>}
  <button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setStep('choose')} disabled={busy}>Back</button>
  <button type="button" className="ds-btn ds-btn-primary" onClick={()=>void add()} disabled={busy||!picked.length}>{busy?'Adding…':`Add ${picked.length} ${picked.length===1?'comic':'comics'}`}</button>
 </>}>
  <ComicMultiPicker value={picked} onChange={next=>{setPicked(next);setError('')}} multiple max={Math.min(MAX_PICK,Math.max(1,room))} disabled={busy} label="Find comics to add"/>
  {picked.length>0&&<ul className="ac2-grades" aria-label="Condition for each comic">{picked.map(issue=>{const have=owned(issue.id);return <li key={issue.id}>
   <span className="ac2-name"><strong>{issue.title} #{issue.number.replace(/^#/,'')}</strong>{have>0&&<small>You already have {have}</small>}</span>
   <label><span className="sr-only">Condition for {issue.title} #{issue.number}</span><select value={grades[issue.id]||'Raw'} onChange={e=>setGrades(g=>({...g,[issue.id]:e.target.value}))}><option value="Raw">Raw (no grade)</option>{quickGrades.map(q=><option key={q.value} value={q.value}>{q.label}</option>)}</select></label>
  </li>})}</ul>}
  <p className="ac2-note">Up to {MAX_PICK} at once. You can add more details to each comic later.</p>
 </Sheet>;
}
