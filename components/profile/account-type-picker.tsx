'use client';
// Collector (personal) or Business (comic shop or dealer). Controlled radio cards; drop into sign-up or Settings.
//   const [type,setType]=useState<AccountType>('collector');
//   <AccountTypePicker value={type} onChange={setType}/>
// Pass `name` to also submit the value with a surrounding <form> (FormData gets 'collector' | 'business').
// At sign-up (before a profile exists) call rememberAccountType(type) from './business-client'; the free
// profile setup form preselects Business and asks for the shop details.
import {useId} from 'react';
import {Store,UserRound} from 'lucide-react';
import type {AccountType} from './business-client';
import './profile.css';

const options:{value:AccountType;title:string;body:string;Icon:typeof Store}[]=[
 {value:'collector',title:'Collector',body:'A personal profile for your own collection.',Icon:UserRound},
 {value:'business',title:'Business',body:'A comic shop or dealer. Add your shop name, logo, location and policies.',Icon:Store},
];

export default function AccountTypePicker({value,onChange,name,disabled=false,legend='Account type',hint}:{value:AccountType;onChange:(value:AccountType)=>void;name?:string;disabled?:boolean;legend?:string;hint?:string}){
 const id=useId();
 return <fieldset className="pf-type" disabled={disabled} aria-describedby={hint?id+'-hint':undefined}>
  <legend>{legend}</legend>
  <div className="pf-type-options">
   {options.map(({value:option,title,body,Icon})=><label key={option} className={'pf-type-option'+(value===option?' is-on':'')}>
    <input type="radio" name={name||id+'-type'} value={option} checked={value===option} onChange={()=>onChange(option)}/>
    <Icon size={22} aria-hidden="true"/>
    <span><strong>{title}</strong><small>{body}</small></span>
   </label>)}
  </div>
  {hint&&<p className="pf-hint" id={id+'-hint'}>{hint}</p>}
 </fieldset>;
}
