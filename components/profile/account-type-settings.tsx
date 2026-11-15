'use client';
// Self-contained Settings panel: switch between Collector and Business and edit shop details.
// Loads and saves through /api/business. Usage (signed-in Settings page): <AccountTypeSettings/>
// Optional: onSaved(business) after a successful save, e.g. to refresh profile data.
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Check} from 'lucide-react';
import AccountTypePicker from './account-type-picker';
import BusinessFields from './business-fields';
import {businessDraftProblem,draftFrom,fetchMyBusiness,saveMyBusiness,type AccountType,type BusinessDraft,type OwnBusiness} from './business-client';
import './profile.css';

export default function AccountTypeSettings({onSaved}:{onSaved?:(business:OwnBusiness)=>void}){
 const [loaded,setLoaded]=useState(false),[profileId,setProfileId]=useState<string|null>(null),[current,setCurrent]=useState<OwnBusiness|null>(null);
 const [type,setType]=useState<AccountType>('collector'),[draft,setDraft]=useState<BusinessDraft>(draftFrom(null));
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();fetchMyBusiness(controller.signal).then(({business,profileId})=>{setProfileId(profileId);setCurrent(business);setType(business?.accountType||'collector');setDraft(draftFrom(business));setLoaded(true)}).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Couldn’t load your account type.');setLoaded(true)}});return()=>controller.abort()},[]);
 if(!loaded)return <p className="pf-hint" role="status">Loading your account type…</p>;
 if(!profileId)return <div className="pf-settings"><AccountTypePicker value={type} onChange={setType} disabled hint="Create your free profile first, then choose Collector or Business here."/><Link className="ds-btn ds-btn-secondary ds-btn-sm" href="/?section=Collectors">Create my profile</Link></div>;
 return <form className="pf-settings" onSubmit={async e=>{e.preventDefault();setMessage('');setError('');
  if(type==='business'){const problem=businessDraftProblem(draft);if(problem){setError(problem);return}}
  setBusy(true);try{const r=await saveMyBusiness(type,draft);setCurrent(r.business);setDraft(draftFrom(r.business));setMessage(r.verificationCleared?'Saved. Your verified tick was removed because your shop details changed. An admin will need to check again.':type==='business'?'Saved. Your profile now shows your shop details.':'Saved. You have a personal collector profile.');onSaved?.(r.business)}catch(err){setError(err instanceof Error?err.message:'Couldn’t save that. Try again.')}finally{setBusy(false)}}}>
  <AccountTypePicker value={type} onChange={setType} disabled={busy} hint={type==='collector'&&current?.accountType==='business'?'Switching to Collector hides your shop details and removes any verified tick. We keep the details in case you switch back.':undefined}/>
  {type==='business'&&<BusinessFields value={draft} onChange={setDraft} disabled={busy} current={current}/>}
  {error&&<p className="ds-error" role="alert">{error}</p>}
  {message&&<p className="pf-ok" role="status">{message}</p>}
  <button type="submit" className="ds-btn ds-btn-primary" disabled={busy}>{busy?'Saving…':'Save account type'} <Check size={18} aria-hidden="true"/></button>
 </form>;
}
