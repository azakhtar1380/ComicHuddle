'use client';
// Shop details for a Business profile. Controlled; the parent saves with saveMyBusiness() from './business-client'.
// Fields are stored structured (name, logo, city, state, website, policies) so verification can be automated later.
import {useId,useState} from 'react';
import {ImagePlus,Trash2} from 'lucide-react';
import {VerifiedBadge} from '../verified-badge';
import {uploadLogo,usStates,type BusinessDraft,type OwnBusiness} from './business-client';
import './profile.css';

export default function BusinessFields({value,onChange,disabled=false,current}:{value:BusinessDraft;onChange:(next:BusinessDraft)=>void;disabled?:boolean;current?:OwnBusiness|null}){
 const id=useId(),[uploading,setUploading]=useState(false),[error,setError]=useState('');
 const set=<K extends keyof BusinessDraft>(key:K,v:BusinessDraft[K])=>onChange({...value,[key]:v});
 const verified=current?.accountType==='business'&&current.verificationStatus==='verified';
 return <div className="pf-biz">
  <div className="pf-biz-status">
   {verified?<p><VerifiedBadge label/> Your business is verified. Changing the shop name, website, city or state removes the tick until we check again.</p>
    :<p>Verified tick: <b>not verified yet</b>. For now a ComicHuddle admin checks businesses by hand. <a className="ds-link" href="/verified" target="_blank" rel="noreferrer">How verification works</a></p>}
  </div>
  <label className="ds-field"><span>What kind of business?</span><select value={value.kind} disabled={disabled} onChange={e=>set('kind',e.target.value==='dealer'?'dealer':'shop')}><option value="shop">Comic shop (storefront)</option><option value="dealer">Dealer (online, shows or by appointment)</option></select></label>
  <label className="ds-field"><span>Shop name <span className="required-mark" aria-hidden="true">*</span></span><input required minLength={2} maxLength={80} value={value.shopName} disabled={disabled} onChange={e=>set('shopName',e.target.value)} placeholder="The name on your sign" autoComplete="organization"/></label>
  <div className="ds-field pf-logo-field">
   <span id={id+'-logo'}>Logo</span>
   <div className="pf-logo-row">
    <span className="pf-logo" aria-hidden="true">{value.logoUrl?<img src={value.logoUrl} alt="" width={64} height={64}/>:(value.shopName.trim().charAt(0).toUpperCase()||'?')}</span>
    <label className="ds-btn ds-btn-secondary ds-btn-sm"><ImagePlus size={16} aria-hidden="true"/> {uploading?'Uploading…':value.logoId?'Replace logo':'Add logo'}
     <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" aria-labelledby={id+'-logo'} disabled={disabled||uploading} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setUploading(true);setError('');try{const logoId=await uploadLogo(file);onChange({...value,logoId,logoUrl:'/api/media?id='+logoId})}catch(err){setError(err instanceof Error?err.message:'Couldn’t upload that logo.')}finally{setUploading(false)}}}/>
    </label>
    {value.logoId&&<button type="button" className="ds-link" disabled={disabled||uploading} onClick={()=>onChange({...value,logoId:null,logoUrl:null})}><Trash2 size={15} aria-hidden="true"/> Remove</button>}
   </div>
   {error&&<small className="ds-error" role="alert">{error}</small>}
  </div>
  <div className="pf-biz-row">
   <label className="ds-field"><span>City <span className="required-mark" aria-hidden="true">*</span></span><input required minLength={2} maxLength={60} value={value.city} disabled={disabled} onChange={e=>set('city',e.target.value)} placeholder="Minneapolis" autoComplete="address-level2"/></label>
   <label className="ds-field"><span>State <span className="required-mark" aria-hidden="true">*</span></span><select required value={value.state} disabled={disabled} onChange={e=>set('state',e.target.value)} autoComplete="address-level1"><option value="" disabled>Pick a state</option>{usStates.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
  </div>
  <p className="pf-hint">City and state only. Never a street address.</p>
  <label className="ds-field"><span>Website</span><input type="url" inputMode="url" maxLength={200} value={value.website} disabled={disabled} onChange={e=>set('website',e.target.value)} placeholder="https://myshop.com" autoCapitalize="none" spellCheck={false}/></label>
  <label className="ds-field"><span>Shipping policy</span><textarea maxLength={1000} rows={3} value={value.shippingPolicy} disabled={disabled} onChange={e=>set('shippingPolicy',e.target.value)} placeholder="How and when you ship, carriers, packing"/></label>
  <label className="ds-field"><span>Returns policy</span><textarea maxLength={1000} rows={3} value={value.returnsPolicy} disabled={disabled} onChange={e=>set('returnsPolicy',e.target.value)} placeholder="What you accept back, and for how long"/></label>
 </div>;
}
