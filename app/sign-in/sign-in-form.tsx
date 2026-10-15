'use client';
import {useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Eye,EyeOff,LockKeyhole,ShieldCheck,Sparkles} from 'lucide-react';
import {authErrorMessage,prepareAuthFields,type AuthFieldErrors} from '../../lib/auth-form';
import './sign-in.css';

function returnPath(){
 const value=new URLSearchParams(window.location.search).get('return_to')||'/';
 if(!value.startsWith('/')||value.startsWith('//'))return '/';
 const parsed=new URL(value,window.location.origin);
 return parsed.origin===window.location.origin&&!parsed.pathname.startsWith('/sign-')?parsed.pathname+parsed.search:'/';
}
export default function SignInForm({initialRegister=false}:{initialRegister?:boolean}){
 const [register,setRegister]=useState(initialRegister),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fieldErrors,setFieldErrors]=useState<AuthFieldErrors>({}),[showPassword,setShowPassword]=useState(false);
 const formRef=useRef<HTMLFormElement>(null),submitting=useRef(false);
 function changeMode(next:boolean){
  if(busy||next===register)return;
  setRegister(next);setError('');setFieldErrors({});setShowPassword(false);
  const password=formRef.current?.elements.namedItem('password');if(password instanceof HTMLInputElement)password.value='';
  const url=new URL(window.location.href);url.searchParams.set('mode',next?'register':'login');window.history.replaceState(null,'',url.pathname+url.search);
 }
 return <main className="auth-shell auth-redesign">
  <header className="auth-header"><a href="/" className="auth-logo" aria-label="ComicHuddle home"><img src="/brand/comichuddle-hero-logo-compact.svg" alt="ComicHuddle" width="125" height="100"/></a><a href="/" className="auth-back"><ArrowLeft size={16}/> Back to the collection</a></header>
  <div className="auth-layout">
   <section className="auth-art" aria-label="Welcome to the collector universe"><img src="/art/collector-universe-v2.webp" alt="Original comic artwork with a cosmic portal and armored adventurers" fetchPriority="low" decoding="async"/><div className="auth-art-copy"><span className="auth-edition"><Sparkles size={15}/> YOUR COLLECTOR ERA STARTS HERE</span><h1>EVERY COMIC.<br/>A <span>CONNECTION.</span></h1><p>Build your shelf. Find your next grail.<br/>Give your collection a place to belong.</p><div className="auth-art-tags"><span><BookOpen size={15}/> Your collection</span><span><ShieldCheck size={15}/> Your collector identity</span></div></div></section>
   <section className="auth-card" aria-labelledby="auth-title">
    <div className="auth-mode" aria-label="Account access"><button type="button" aria-pressed={!register} className={!register?'active':''} disabled={busy} onClick={()=>changeMode(false)}>Log In</button><button type="button" aria-pressed={register} className={register?'active':''} disabled={busy} onClick={()=>changeMode(true)}>Sign Up</button></div>
    <div className="eyebrow">ONE ACCOUNT. YOUR WHOLE COMIC WORLD.</div><h2 id="auth-title">{register?'START YOUR':'GOOD TO HAVE'}<br/><span>{register?'NEXT CHAPTER.':'YOU BACK.'}</span></h2><p className="auth-intro">{register?'Create your free collector account. Your shelf, marketplace and Comic Workshop live here.':'Your shelf is waiting. Log in to pick up where you left off.'}</p>
    <form ref={formRef} noValidate onSubmit={async event=>{
     event.preventDefault();if(submitting.current)return;
     const form=event.currentTarget,data=new FormData(form);
     const {values,errors}=prepareAuthFields({email:String(data.get('email')||''),password:String(data.get('password')||''),name:String(data.get('name')||'')},register);
     setError('');setFieldErrors(errors);
     const first=Object.keys(errors)[0];if(first){const input=form.elements.namedItem(first);if(input instanceof HTMLElement)input.focus();return}
     submitting.current=true;setBusy(true);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
     try{
      const response=await fetch('/api/auth/'+(register?'sign-up/email':'sign-in/email'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({email:values.email,password:values.password,...(register?{name:values.name}:{})})});
      const result:unknown=await response.json().catch(()=>null);
      if(!response.ok){setError(authErrorMessage(result,response.status,register));return}
      window.location.assign(returnPath());
     }catch{setError(controller.signal.aborted?'The account service took too long to respond. If you were creating an account, try logging in before creating it again.':'Could not reach the account service. Check your connection and retry.');}
     finally{clearTimeout(timer);submitting.current=false;setBusy(false)}
    }}>
     {register&&<label htmlFor="auth-name"><span>Display name <span className="required-mark" aria-hidden="true">*</span></span><input id="auth-name" name="name" required minLength={2} maxLength={60} autoComplete="nickname" placeholder="Your collector name" aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name?'auth-name-error':undefined}/>{fieldErrors.name&&<small id="auth-name-error" className="auth-field-error">{fieldErrors.name}</small>}</label>}
     <label htmlFor="auth-email"><span>Email <span className="required-mark" aria-hidden="true">*</span></span><input id="auth-email" name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email?'auth-email-error':undefined}/>{fieldErrors.email&&<small id="auth-email-error" className="auth-field-error">{fieldErrors.email}</small>}</label>
     <label htmlFor="auth-password"><span>Password <span className="required-mark" aria-hidden="true">*</span></span><div className="auth-password"><input id="auth-password" name="password" type={showPassword?'text':'password'} required minLength={register?12:undefined} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder={register?'Create a password':'Enter your password'} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password?'auth-password-error':register?'auth-password-help':undefined}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{fieldErrors.password?<small id="auth-password-error" className="auth-field-error">{fieldErrors.password}</small>:register&&<small id="auth-password-help">At least 12 characters. Spaces and symbols are welcome.</small>}</label>
     {error&&<p role="alert" className="auth-error">{error}</p>}
     <button type="submit" className="button red auth-submit" disabled={busy}>{busy?'Connecting…':register?'Create free account':'Log in'} {!busy&&<ArrowRight size={17}/>}</button>
    </form>
    <p className="auth-switch">{register?'Already a collector?':'New to ComicHuddle?'} <button type="button" disabled={busy} onClick={()=>changeMode(!register)}>{register?'Log in':'Create a free account'}</button></p>
    <div className="auth-footnote"><LockKeyhole size={14}/><p>Your account uses a secure connection. Email recovery is not connected in this preview; keep your password safe.</p></div>
   </section>
  </div>
 </main>;
}
