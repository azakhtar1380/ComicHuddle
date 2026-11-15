// Client helpers for personal/business profiles (/api/business). Types come from lib/business-profile.ts
// as type-only imports, so no server code reaches the browser.
import type {AccountType,BusinessKind,OwnBusiness,BusinessSummary,PublicBusiness} from '../../lib/business-profile';
export type {AccountType,BusinessKind,OwnBusiness,BusinessSummary,PublicBusiness};

export const usStates:[string,string][]=[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['PR','Puerto Rico'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']];

/** What the business form edits. */
export type BusinessDraft={kind:BusinessKind;shopName:string;logoId:string|null;logoUrl:string|null;city:string;state:string;website:string;shippingPolicy:string;returnsPolicy:string};
export const emptyBusinessDraft:BusinessDraft={kind:'shop',shopName:'',logoId:null,logoUrl:null,city:'',state:'',website:'',shippingPolicy:'',returnsPolicy:''};
export const draftFrom=(b:OwnBusiness|null|undefined):BusinessDraft=>b?{kind:b.kind,shopName:b.shopName,logoId:b.logoId,logoUrl:b.logoId?'/api/media?id='+encodeURIComponent(b.logoId):null,city:b.city,state:b.state,website:b.website,shippingPolicy:b.shippingPolicy,returnsPolicy:b.returnsPolicy}:emptyBusinessDraft;

/** Same rules the server enforces, so people see problems before anything is saved. '' when fine. */
export function businessDraftProblem(d:BusinessDraft){
 if(d.shopName.trim().length<2)return 'Add your shop name.';
 if(d.city.trim().length<2)return 'Add the city your shop is in.';
 if(!usStates.some(([code])=>code===d.state))return 'Pick the state your shop is in.';
 const site=d.website.trim();
 if(site){try{const url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(site)?site:'https://'+site);if(!['http:','https:'].includes(url.protocol)||!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname))throw Error()}catch{return 'Enter a website like https://myshop.com, or leave it blank.'}}
 return '';
}

export async function fetchMyBusiness(signal?:AbortSignal){
 const r=await fetch('/api/business?kind=mine',{credentials:'same-origin',cache:'no-store',signal});
 const d=await r.json().catch(()=>({})) as {business?:OwnBusiness|null;profileId?:string|null;error?:string};
 if(!r.ok)throw Error(d.error||'Couldn’t load your account type.');
 return {business:d.business||null,profileId:d.profileId||null};
}

export async function saveMyBusiness(accountType:AccountType,draft:BusinessDraft){
 const r=await fetch('/api/business',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',accountType,kind:draft.kind,shopName:draft.shopName,logoId:draft.logoId,city:draft.city,state:draft.state,website:draft.website,shippingPolicy:draft.shippingPolicy,returnsPolicy:draft.returnsPolicy})});
 const d=await r.json().catch(()=>({})) as {business?:OwnBusiness;verificationCleared?:boolean;error?:string};
 if(!r.ok||!d.business)throw Error(d.error||'Couldn’t save your shop details. Try again.');
 return {business:d.business,verificationCleared:!!d.verificationCleared};
}

/** Upload a logo through the existing /api/media photo upload. Returns the media id. */
export async function uploadLogo(file:File){
 if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Pick a JPEG, PNG or WebP logo.');
 if(file.size>20000000)throw Error('That logo is over 20 MB. Try a smaller one.');
 const bitmap=await createImageBitmap(file),ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
 canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const ctx=canvas.getContext('2d');
 if(!ctx){bitmap.close();throw Error('Couldn’t prepare this logo. Try another.')}
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const blob=await new Promise<Blob|null>(res=>canvas.toBlob(res,'image/jpeg',.9));if(!blob)throw Error('Couldn’t prepare this logo. Try another.');
 const r=await fetch('/api/media',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg'},body:blob}),d=await r.json().catch(()=>({})) as {error?:string;id?:string};
 if(!r.ok||!d.id)throw Error(d.error||'Couldn’t upload that logo. Try again.');return d.id;
}

// Sign-up can remember the choice until the free profile is created (same tab only).
const KEY='comichuddle-account-type';
export function rememberAccountType(type:AccountType){try{sessionStorage.setItem(KEY,type)}catch{/* storage blocked */}}
export function rememberedAccountType():AccountType|null{try{const v=sessionStorage.getItem(KEY);return v==='business'||v==='collector'?v:null}catch{return null}}
export function forgetAccountType(){try{sessionStorage.removeItem(KEY)}catch{/* storage blocked */}}
