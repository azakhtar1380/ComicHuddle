'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {BookOpen,Check,Search,X} from 'lucide-react';
import {catalog,type Issue} from '../lib/catalog';
import type {Vault} from '../lib/vault';
import ComicPicker from './comic-picker';
import {SelectedComicList} from './comic-multi-picker';
import {issueIdentity,listingDirectoryId} from '../lib/shared-catalog';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import {collectionGrade,ownershipFromForm,rawConditions,collectionGrades,slabLabels} from '../lib/collection-entry';
import {quickGrades} from '../lib/listing-grades';
import HuddlesGuide,{HuddlesArt,HuddlesTip} from '../components/huddles-guide';
import './add-comic.css';

type Props={vault:Vault;commit:(vault:Vault)=>Promise<boolean>;saving:boolean;onSaved:()=>void;allowMultiple?:boolean};
function EntryMode({manual,setManual,disabled}:{manual:boolean;setManual:(value:boolean)=>void;disabled:boolean}){
 return <div className="comic-entry-mode" role="group" aria-label="How do you want to add it?"><button type="button" aria-pressed={!manual} disabled={disabled} className={!manual?'selected':''} onClick={()=>setManual(false)}><Search size={16}/> Search the directory</button><button type="button" aria-pressed={manual} disabled={disabled} className={manual?'selected':''} onClick={()=>setManual(true)}><BookOpen size={16}/> Add by hand</button></div>;
}
function ManualFields({title='',issue='',required=true}:{title?:string;issue?:string;required?:boolean}){return <div className="manual-comic-fields"><p className="ac-help">Just for your collection. You can link it to the directory later.</p><label className="ds-field"><span>Title<span className="required-mark" aria-hidden="true"> *</span></span><input name="title" defaultValue={title} placeholder="e.g. Amazing Spider-Man" maxLength={160} required={required}/></label><label className="ds-field"><span>Issue / edition<span className="required-mark" aria-hidden="true"> *</span></span><input name="issue" defaultValue={issue} placeholder="e.g. #300 · second printing" maxLength={40} required={required}/></label></div>}

/** One numbered section of the form. */
function Step({n,title,optional=false,art,children}:{n:number;title:string;optional?:boolean;art?:ReactNode;children:ReactNode}){
 return <section className="ac-step" aria-labelledby={'ac-step-'+n}>
  <div className="ac-step-head"><span className="ac-step-num" aria-hidden="true">{n}</span><h3 id={'ac-step-'+n}><span className="ac-sr">Step {n}: </span>{title}{optional&&<em> · optional</em>}</h3>{art}</div>
  <div className="ac-step-body">{children}</div>
 </section>;
}
function Progress({labels,current}:{labels:string[];current:number}){
 return <ol className="ds-steps ac-progress" aria-label="Steps">{labels.map((label,index)=><li key={label} className={index+1<current?'done':index+1===current?'current':''} aria-current={index+1===current?'step':undefined}><span className="ac-dot" aria-hidden="true">{index+1<current?<Check size={14}/>:index+1}</span>{label}</li>)}</ol>;
}
function FormHead({eyebrow,title,lede}:{eyebrow:string;title:string;lede:ReactNode}){
 return <header className="ac-head"><div className="ac-head-copy"><p className="ds-eyebrow">{eyebrow}</p><h2>{title}</h2><p className="ac-lede">{lede}</p><HuddlesTip>Every detail counts.</HuddlesTip></div><HuddlesGuide pose="add-comic" size="md" className="ac-huddles"/></header>;
}
const stepLabels=['Pick issue','Condition & grade','Private details'];
const gradingArt=<HuddlesArt pose="grading" size="sm" className="ac-step-art" decorative/>;

type PendingComic={id:string;title:string;issue:string;directory?:Issue};
export default function AddComicForm({vault,commit,saving,onSaved,allowMultiple=false}:Props){
 const [copyCount,setCopyCount]=useState(1),gradeInput=useRef<HTMLInputElement>(null),[gradeValue,setGradeValue]=useState('');
 const [entries,setEntries]=useState<PendingComic[]>([]),[multiple,setMultiple]=useState(false),[manual,setManual]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[graded,setGraded]=useState(false);
 const formRef=useRef<HTMLFormElement>(null),submitting=useRef(false),manualId=useRef<string|null>(null),extraIds=useRef<string[]>([]);
 const limit=Math.max(0,1000-vault.books.length),disabled=saving||busy;
 function addIssue(issue:Issue|null){if(!issue)return;setError('');if(entries.some(entry=>entry.directory?.id===issue.id)){setError('That comic is already on your list.');return}if(!limit||multiple&&entries.length>=limit){setError('Your collection can hold up to 1,000 comics.');return}const next={id:crypto.randomUUID(),title:issue.title,issue:'#'+issue.number,directory:issue};setEntries(previous=>multiple?[...previous,next]:[next])}
 function manualEntry(data:FormData):PendingComic|null{const title=String(data.get('title')||'').trim(),issue=String(data.get('issue')||'').trim();if(!title&&!issue)return null;if(!title||!issue)throw Error('Add both a title and an issue number.');manualId.current ||= crypto.randomUUID();return {id:manualId.current,title,issue}}
 function addManual(){if(!formRef.current)return;try{const next=manualEntry(new FormData(formRef.current));if(!next)throw Error('Type the title and issue first.');if(!limit||multiple&&entries.length>=limit)throw Error('Your collection can hold up to 1,000 comics.');setEntries(previous=>multiple?[...previous,next]:[next]);manualId.current=null;for(const name of ['title','issue']){const field=formRef.current.elements.namedItem(name);if(field instanceof HTMLInputElement)field.value=''}setError('')}catch(problem){setError(problem instanceof Error?problem.message:'Check the comic details.')}}
 const current=!entries.length&&!manual?1:!graded?2:3;
 return <div className="form-dialog collection-comic-form ac-form">
  <FormHead eyebrow={allowMultiple?'Build your listing':'Your collection'} title={multiple?'Add comics':'Add a comic'} lede="Pick the exact issue. What you paid stays private."/>
  <Progress labels={stepLabels} current={current}/>
  <form ref={formRef} onSubmit={async event=>{
  event.preventDefault();if(submitting.current)return;setError('');const data=new FormData(event.currentTarget);let chosen=[...entries];
  try{if(manual){const pending=manualEntry(data);if(pending)chosen=multiple?[...chosen,pending]:[pending]}if(!chosen.length)throw Error('Pick at least one comic, or add one by hand.');if(chosen.length>limit)throw Error('Your collection can hold up to 1,000 comics.')}catch(problem){setError(problem instanceof Error?problem.message:'Check your comics.');return}
  // Keep copy IDs stable if an acknowledgement is lost and the user retries.
  setEntries(chosen);if(manual){manualId.current=null;for(const name of ['title','issue']){const field=event.currentTarget.elements.namedItem(name);if(field instanceof HTMLInputElement)field.value=''}}
  // "How many copies" (one comic only) saves that many separate copies; extra copy IDs stay stable across retries.
  const count=!multiple&&chosen.length===1?Math.min(Math.max(1,Math.floor(copyCount)||1),limit):1;if(extraIds.current.length<count-1)extraIds.current=[...extraIds.current,...Array.from({length:count-1-extraIds.current.length},()=>crypto.randomUUID())];
  const expanded=count>1?[chosen[0],...extraIds.current.slice(0,count-1).map(id=>({...chosen[0],id}))]:chosen;
  const copies=expanded.map(entry=>({id:entry.id,title:entry.title,issue:entry.issue,grade:String(data.get('grade')||'').trim(),price:Number(data.get('price')||0),...(entry.directory?issueIdentity(entry.directory):{})}));
  const ids=new Set(copies.map(copy=>copy.id)),books=[...vault.books.filter(copy=>!ids.has(copy.id)),...copies],tradeBookIds=[...vault.tradeBookIds.filter(id=>!ids.has(id)),...(data.get('trade')?copies.map(copy=>copy.id):[])];
  submitting.current=true;setBusy(true);
  try{if(await commit({...vault,books,tradeBookIds}))onSaved();else setError('We’re not sure that saved. Your picks are still here. Try again.')}catch{setError('Couldn’t save your comics. Your picks are still here. Try again.')}finally{submitting.current=false;setBusy(false)}
 }}><fieldset className="comic-form-fields" disabled={disabled}>
  <Step n={1} title="Pick issue">
   <div className="comic-count-mode"><div className="mp-choice-buttons" role="group" aria-label="How many comics?"><button type="button" className={!multiple?'selected':''} aria-pressed={!multiple} onClick={()=>{setMultiple(false);setEntries(previous=>previous.slice(0,1));setError('')}}>One comic</button><button type="button" className={multiple?'selected':''} aria-pressed={multiple} onClick={()=>{setMultiple(true);setError('')}}>Several comics</button></div></div>
   <EntryMode manual={manual} disabled={disabled} setManual={value=>{setManual(value);setError('');manualId.current=null}}/>
   {manual?<><ManualFields required={!entries.length}/><button type="button" className="ds-btn ds-btn-secondary ac-add-manual" onClick={addManual}>Add to my list</button></>:<ComicPicker value={null} disabled={disabled} clearOnChoose onChange={addIssue} label="Search for your comic" helper="Search by title, issue, year, publisher or character. Pick the exact edition."/>}
   {!multiple&&<label className="ds-field ac-copies"><span>How many copies do you have?</span><input type="number" inputMode="numeric" min="1" max={Math.max(1,Math.min(100,limit))} value={copyCount} onChange={event=>setCopyCount(Math.max(1,Math.min(100,Number(event.target.value)||1)))}/><small>Each copy is saved separately, so you can grade or sell them one at a time.</small></label>}
   <SelectedComicList items={entries.map(entry=>({id:entry.id,title:entry.title,issue:entry.issue,cover:entry.directory?.cover,subtitle:entry.directory?[entry.directory.publisher,entry.directory.year||null,entry.directory.variant].filter(Boolean).join(' · '):'Added by hand'}))} disabled={disabled} onRemove={id=>setEntries(previous=>previous.filter(entry=>entry.id!==id))}/>
  </Step>
  <Step n={2} title="Condition & grade" art={gradingArt}>
   <label className="ds-field"><span>{multiple?'Condition or grade for these comics':'Condition or grade'}</span><input ref={gradeInput} name="grade" value={gradeValue} placeholder="e.g. Raw VF or CGC 9.8 Universal" maxLength={80} onChange={event=>{setGradeValue(event.target.value);setGraded(!!event.target.value.trim())}}/><small>Tap a common grade or type your own. Leave it blank if you’re not sure.</small></label>
   <div className="ac-grade-chips" role="group" aria-label="Common grades">{quickGrades.map(option=><button type="button" key={option.value} className={'ac-grade-chip'+(gradeValue===option.value?' is-on':'')} aria-pressed={gradeValue===option.value} onClick={()=>{const next=gradeValue===option.value?'':option.value;setGradeValue(next);setGraded(!!next);gradeInput.current?.focus()}}>{option.label}</button>)}</div>
  </Step>
  <Step n={3} title="Private details" optional>
   <label className="ds-field"><span>What you paid {multiple||copyCount>1?'per comic ':''}(USD)</span><input name="price" type="number" inputMode="decimal" min="0" max="10000000" step="0.01" placeholder="0.00"/><small>Only you can see this. Leave it blank if you’d rather not say.</small></label>
   <label className="check-label ac-check"><input type="checkbox" name="trade"/> I’m open to trading {multiple?'these comics':'this comic'}</label>
   <p className="ac-help">{multiple?'This condition and price apply to every comic you picked. You can change each one later. ':''}Only add comics you own.</p>
  </Step>
  <div className="ac-save-bar">
   {error&&<p className="ds-error ac-error" role="alert"><X size={16} aria-hidden="true"/> {error}</p>}
   <button type="submit" className="ds-btn ds-btn-primary ac-save" disabled={disabled||!manual&&!entries.length}>{disabled?'Saving…':allowMultiple?'Save & back to listing':multiple?'Save comics':copyCount>1?'Save '+copyCount+' copies':'Save to my collection'} <Check size={18}/></button>
  </div>
 </fieldset></form></div>;
}

export function OwnedComicForm({vault,bookId,commit,saving,listed,onSaved}:Props&{bookId:string;listed:boolean}){
 const copy=vault.books.find(book=>book.id===bookId)!;
 const [format,setFormat]=useState<'RAW'|'GRADED'>(copy.ownership?.format||'RAW');
 const [selected,setSelected]=useState<Issue|null>(copy.catalogId!==undefined?catalog[copy.catalogId]??null:null),[manual,setManual]=useState(copy.catalogId===undefined&&!copy.externalCatalog),[unlink,setUnlink]=useState(false),[error,setError]=useState('');
 const linkedLookup=useRef(0);
 useEffect(()=>{if(!copy.externalCatalog)return;const lookup=++linkedLookup.current,controller=new AbortController(),directoryId=listingDirectoryId(copy);let active=true;void fetch('/api/catalog?id='+directoryId,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const page=parseCatalogSearchPage(await r.json());if(!page.issues[0]||page.issues[0].id!==directoryId)throw Error();return page.issues[0]}).then(issue=>{if(active&&linkedLookup.current===lookup)setSelected(issue)}).catch(()=>{if(active&&linkedLookup.current===lookup){setManual(true);setError('This issue isn’t in the directory yet. You can still keep it.')}});return()=>{active=false;controller.abort()}},[copy.id]);
 return <div className="form-dialog collection-comic-form ac-form">
  <FormHead eyebrow="Your copy" title="Edit comic" lede={<>{copy.title} {copy.issue}<br/>Pick the exact issue. What you paid stays private.</>}/>
  <Progress labels={stepLabels} current={manual||selected?2:1}/>
  <form onSubmit={async event=>{
  event.preventDefault();setError('');if(listed){setError('This comic is listed for sale. Take down the listing to edit it.');return}if(!manual&&!selected){setError('Pick the exact issue, or choose Add by hand.');return}
  const data=new FormData(event.currentTarget),{catalogId:previous,externalCatalog:previousExternal,...own}=copy;void previous;
  const title=manual?String(data.get('title')).trim():selected!.title,issue=manual?String(data.get('issue')).trim():'#'+selected!.number;
  const identity=!manual?issueIdentity(selected!):previousExternal&&!unlink&&title===copy.title&&issue===copy.issue?{externalCatalog:previousExternal}:{};
  let ownership=copy.ownership;try{if(ownership)ownership=ownershipFromForm(data,format)}catch{setError('Check the condition, grade, cert number, price and date.');return}
  const updated={...own,condition:undefined,title,issue,grade:ownership?collectionGrade(ownership):String(data.get('grade')||'').trim(),price:Number(data.get('price')),...identity,...(ownership?{ownership}:{})};
  if(await commit({...vault,books:vault.books.map(book=>book.id===bookId?updated:book)}))onSaved();
 }}><fieldset className="comic-form-fields" disabled={saving||listed}>
  {listed&&<p className="ds-error ac-error ac-listed" role="status"><X size={16} aria-hidden="true"/> This comic is listed for sale. Take down the listing to edit it.</p>}
  <Step n={1} title="Pick issue">
   <EntryMode manual={manual} disabled={saving||listed} setManual={value=>{linkedLookup.current++;setManual(value);setUnlink(value);setSelected(null);setError('')}}/>
   {manual?<ManualFields title={copy.title} issue={copy.issue}/>:<ComicPicker value={selected} disabled={saving||listed} label="Search for your comic" onChange={issue=>{linkedLookup.current++;setSelected(issue);setError('')}}/>}
  </Step>
  <Step n={2} title="Condition & grade" art={gradingArt}>
   {copy.ownership?<>
    <label className="ds-field"><span>Raw or graded?</span><select value={format} onChange={event=>setFormat(event.target.value as 'RAW'|'GRADED')}><option value="RAW">Raw / ungraded</option><option value="GRADED">CGC graded</option></select></label>
    {format==='RAW'?<label className="ds-field"><span>Condition</span><select name="rawCondition" defaultValue={copy.ownership.rawCondition||''}><option value="">Not set</option>{rawConditions.map(value=><option value={value} key={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
     :<><label className="ds-field"><span>CGC grade<span className="required-mark" aria-hidden="true"> *</span></span><select name="grade" defaultValue={copy.ownership.grade||''} required><option value="" disabled>Pick a grade</option>{collectionGrades.map(value=><option key={value}>{value}</option>)}</select></label><label className="ds-field"><span>Label type</span><select name="labelType" defaultValue={copy.ownership.labelType||'Universal'}>{slabLabels.map(value=><option key={value}>{value}</option>)}</select></label><label className="ds-field"><span>Cert number<span className="required-mark" aria-hidden="true"> *</span></span><input name="certificationNumber" inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} defaultValue={copy.ownership.certificationNumber||''} required/><small>On the CGC label. 5 to 20 digits.</small></label></>}
   </>:<label className="ds-field"><span>Condition or grade<span className="required-mark" aria-hidden="true"> *</span></span><input name="grade" maxLength={80} defaultValue={copy.grade} placeholder="e.g. Raw VF or CGC 9.8 Universal" required disabled={listed}/><small>Raw (like VF) or slabbed (like CGC 9.8).</small></label>}
  </Step>
  <Step n={3} title="Private details" optional>
   <label className="ds-field"><span>What you paid (USD)<span className="required-mark" aria-hidden="true"> *</span></span><input name="price" type="number" inputMode="decimal" min="0" max="10000000" step="0.01" defaultValue={copy.price} required disabled={listed}/><small>Only you can see this.</small></label>
   {copy.ownership&&<>
    <label className="ds-field"><span>Purchase price for your records (USD)</span><input name="purchasePrice" inputMode="decimal" defaultValue={copy.ownership.purchasePriceCents===null?'':(Number(copy.ownership.purchasePriceCents)/100).toFixed(2)}/></label>
    <label className="ds-field"><span>Date you got it</span><input name="acquiredOn" type="date" defaultValue={copy.ownership.acquiredOn||''}/></label>
    <label className="ds-field"><span>Private notes</span><textarea name="notes" maxLength={500} rows={3} defaultValue={copy.ownership.notes}/></label>
   </>}
   <p className="ac-help"><b>Only you can see this.</b> Prices and notes never show on your profile or listings.</p>
  </Step>
  <div className="ac-save-bar">
   {error&&<p className="ds-error ac-error" role="alert"><X size={16} aria-hidden="true"/> {error}</p>}
   <button type="submit" className="ds-btn ds-btn-primary ac-save" disabled={saving||listed||!manual&&!selected}>Save changes <Check size={18}/></button>
  </div>
 </fieldset></form></div>;
}
