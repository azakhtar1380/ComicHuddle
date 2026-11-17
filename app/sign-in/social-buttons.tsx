'use client';
// "Continue with Google" / "Continue with Apple", following each brand's button guidelines
// (Google: white, 1px #747775 border, the four-colour G; Apple: black, white Apple logo). Shown above "or use email".
import {useState} from 'react';

function GoogleG(){return <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>}
function AppleLogo(){return <svg viewBox="0 0 17 20" width="17" height="20" aria-hidden="true"><path fill="#fff" d="M14.04 10.63c-.02-2.3 1.88-3.41 1.97-3.46-1.07-1.57-2.74-1.78-3.33-1.8-1.42-.14-2.77.84-3.49.84-.72 0-1.83-.82-3.01-.8-1.55.02-2.98.9-3.78 2.29-1.61 2.8-.41 6.94 1.16 9.21.77 1.11 1.68 2.36 2.88 2.31 1.16-.05 1.6-.75 2.99-.75 1.4 0 1.79.75 3.01.73 1.24-.02 2.03-1.13 2.79-2.25.88-1.29 1.24-2.53 1.26-2.6-.03-.01-2.42-.93-2.45-3.72zM11.75 3.88c.64-.77 1.07-1.85.95-2.92-.92.04-2.03.61-2.69 1.38-.59.68-1.11 1.77-.97 2.82 1.03.08 2.07-.52 2.71-1.28z"/></svg>}

export default function SocialButtons({google,apple,returnTo,disabled,failed}:{google:boolean;apple:boolean;returnTo:()=>string;disabled?:boolean;failed?:boolean}){
 const [busy,setBusy]=useState<'google'|'apple'|null>(null),[error,setError]=useState(failed?'That sign-in didn’t finish. Try again, or use your email.':'');
 if(!google&&!apple)return null;
 async function go(provider:'google'|'apple'){
  if(busy)return;setBusy(provider);setError('');
  try{
   const response=await fetch('/api/auth/sign-in/social',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,callbackURL:returnTo(),errorCallbackURL:'/sign-in?social=error'})});
   const body=await response.json().catch(()=>null) as {url?:string}|null;
   if(!response.ok||!body?.url)throw Error();
   const url=new URL(body.url);if(!['accounts.google.com','appleid.apple.com'].includes(url.hostname))throw Error();
   window.location.assign(url.href);
  }catch{setError('Couldn’t start sign-in. Try again, or use your email.');setBusy(null)}
 }
 return <div className="auth-social">
  {apple&&<button type="button" className="auth-social-btn auth-apple" disabled={disabled||!!busy} onClick={()=>void go('apple')}><AppleLogo/><span>{busy==='apple'?'Opening Apple…':'Continue with Apple'}</span></button>}
  {google&&<button type="button" className="auth-social-btn auth-google" disabled={disabled||!!busy} onClick={()=>void go('google')}><GoogleG/><span>{busy==='google'?'Opening Google…':'Continue with Google'}</span></button>}
  {error&&<p role="alert" className="auth-v2-error">{error}</p>}
  <p className="auth-or" aria-hidden="true"><span>or use email</span></p>
 </div>;
}
