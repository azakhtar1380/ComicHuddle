'use client';
import {useRef,useState} from 'react';
import {AlertCircle,ArrowRight,Eye,EyeOff,LockKeyhole} from 'lucide-react';
import {authErrorMessage,prepareAuthFields,type AuthFieldErrors} from '../../lib/auth-form';
import {operator} from '../../lib/operator';
import HuddlesGuide from '../../components/huddles-guide';
import AccountTypePicker from '../../components/profile/account-type-picker';
import {rememberAccountType,type AccountType} from '../../components/profile/business-client';
import './sign-in.css';

function returnPath(){
 const value=new URLSearchParams(window.location.search).get('return_to')||'/';
 if(!value.startsWith('/')||value.startsWith('//'))return '/';
 const parsed=new URL(value,window.location.origin);
 return parsed.origin===window.location.origin&&!parsed.pathname.startsWith('/sign-')?parsed.pathname+parsed.search:'/';
}
function FieldError({id,children}:{id:string;children:string}){return <small id={id} className="ds-error auth-field-error"><AlertCircle size={16} aria-hidden="true"/> {children}</small>}
export default function SignInForm({initialRegister=false}:{initialRegister?:boolean}){
 const [passwordLength,setPasswordLength]=useState(0),[accountType,setAccountType]=useState<AccountType>('collector');const [register,setRegister]=useState(initialRegister),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fieldErrors,setFieldErrors]=useState<AuthFieldErrors>({}),[rulesError,setRulesError]=useState(''),[showPassword,setShowPassword]=useState(false);
 const formRef=useRef<HTMLFormElement>(null),submitting=useRef(false);
 function changeMode(next:boolean){
  if(busy||next===register)return;
  setRegister(next);setPasswordLength(0);setError('');setFieldErrors({});setRulesError('');setShowPassword(false);
  const password=formRef.current?.elements.namedItem('password');if(password instanceof HTMLInputElement)password.value='';
  const url=new URL(window.location.href);url.searchParams.set('mode',next?'register':'login');window.history.replaceState(null,'',url.pathname+url.search);
 }
 return <main id="main-content" tabIndex={-1} className="ds-wrap auth-v2">
  <div className="auth-v2-layout">
   <section className="auth-v2-card" aria-labelledby="auth-title">
    <div className="auth-v2-mode" role="group" aria-label="Log in or join"><button type="button" aria-pressed={!register} className={!register?'active':''} disabled={busy} onClick={()=>changeMode(false)}>Log in</button><button type="button" aria-pressed={register} className={register?'active':''} disabled={busy} onClick={()=>changeMode(true)}>Join free</button></div>
    <p className="ds-eyebrow">{register?'Free account':'Welcome back'}</p>
    <h1 id="auth-title" className="auth-v2-title">{register?<>Join <span>ComicHuddle.</span></>:<>Good to see <span>you again.</span></>}</h1>
    <p className="auth-v2-lede">{register?'Just an email and a password. Everything else can wait.':'Log in to pick up where you left off.'}</p>
    <form ref={formRef} noValidate className="auth-v2-form" onSubmit={async event=>{
     event.preventDefault();if(submitting.current)return;
     const form=event.currentTarget,data=new FormData(form);
     const {values,errors}=prepareAuthFields({email:String(data.get('email')||''),password:String(data.get('password')||''),name:String(data.get('name')||'')},register);
     const rulesMissing=register&&data.get('rules')!=='on';
     setError('');setFieldErrors(errors);setRulesError(rulesMissing?'Check this box to join.':'');
     const first=Object.keys(errors)[0]||(rulesMissing?'rules':'');if(first){const input=form.elements.namedItem(first);if(input instanceof HTMLElement)input.focus();return}
     submitting.current=true;setBusy(true);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
     try{
      const response=await fetch('/api/auth/'+(register?'sign-up/email':'sign-in/email'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({email:values.email,password:values.password,...(register?{name:values.name}:{})})});
      const result:unknown=await response.json().catch(()=>null);
      if(!response.ok){setError(authErrorMessage(result,response.status,register));return}
      window.location.assign(returnPath());
     }catch{setError(controller.signal.aborted?'That took too long. If you were joining, try logging in first.':'Couldn’t connect. Check your internet and try again.');}
     finally{clearTimeout(timer);submitting.current=false;setBusy(false)}
    }}>
     
     <label className="ds-field" htmlFor="auth-email"><span>Email <span className="required-mark" aria-hidden="true">*</span></span><input id="auth-email" name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email?'auth-email-error':undefined}/>{fieldErrors.email&&<FieldError id="auth-email-error">{fieldErrors.email}</FieldError>}</label>
     <label className="ds-field" htmlFor="auth-password"><span>Password <span className="required-mark" aria-hidden="true">*</span></span><div className="auth-v2-password"><input id="auth-password" name="password" type={showPassword?'text':'password'} required minLength={register?12:undefined} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder={register?'Make a password':'Your password'} onChange={event=>setPasswordLength(event.currentTarget.value.length)} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password?'auth-password-error':register?'auth-password-help':undefined}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={20}/>:<Eye size={20}/>}</button></div>{fieldErrors.password?<FieldError id="auth-password-error">{fieldErrors.password}</FieldError>:register&&<small id="auth-password-help" className={'auth-pw-rule'+(passwordLength>=12?' is-met':'')} aria-live="polite">{passwordLength>=12?'✓ Long enough':'At least 12 characters'}{passwordLength>0&&passwordLength<12?' · '+(12-passwordLength)+' to go':''}. A short phrase works well.</small>}</label>
     {register&&<label className="ds-field" htmlFor="auth-name"><span>Display name <small className="auth-optional">Optional</small></span><input id="auth-name" name="name" minLength={2} maxLength={60} autoComplete="nickname" placeholder="What collectors will see" aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name?'auth-name-error':'auth-name-help'}/>{fieldErrors.name?<FieldError id="auth-name-error">{fieldErrors.name}</FieldError>:<small id="auth-name-help">Leave it blank and we’ll use the start of your email. You can change it any time.</small>}</label>}{register&&<AccountTypePicker value={accountType} onChange={v=>{setAccountType(v);rememberAccountType(v)}} disabled={busy} legend="I’m joining as" hint="A shop or dealer adds its shop details later. You can switch any time in Settings."/>}{register&&<div className="auth-v2-check-wrap"><label className="auth-v2-check" htmlFor="auth-rules"><input id="auth-rules" name="rules" type="checkbox" required aria-invalid={!!rulesError} aria-describedby={rulesError?'auth-rules-error':undefined} onChange={event=>{if(event.currentTarget.checked)setRulesError('')}}/><span>I’m 18+, live in the US, and agree to the <a href="/?section=Rules" target="_blank" rel="noreferrer">collector rules</a>.<span className="required-mark" aria-hidden="true"> *</span></span></label>{rulesError&&<FieldError id="auth-rules-error">{rulesError}</FieldError>}</div>}
     {error&&<p role="alert" className="auth-v2-error"><AlertCircle size={18} aria-hidden="true"/> {error}</p>}
     <button type="submit" className="ds-btn ds-btn-primary auth-v2-submit" disabled={busy}>{busy?'One sec…':register?'Join free':'Log in'} {!busy&&<ArrowRight size={18} aria-hidden="true"/>}</button>
    </form>
    <p className="auth-v2-switch">{register?'Already have an account?':'New here?'} <button type="button" className="ds-link" disabled={busy} onClick={()=>changeMode(!register)}>{register?'Log in':'Join free'}</button></p>
    <div className="auth-v2-foot"><LockKeyhole size={16} aria-hidden="true"/><p>Your password is stored securely. Nobody can read it. Forgot it? <a href={'mailto:'+operator.supportEmail+'?subject=Password%20help'}>Email support</a> from your account email.</p></div>
   </section>
   <HuddlesGuide pose="sign-in" caption="COME ON IN" line="Join free. It takes a minute." size="xl" className="auth-v2-art"/>
  </div>
 </main>;
}
