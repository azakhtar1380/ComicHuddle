'use client';
import {useEffect,useRef,useState} from 'react';
import {BookOpen,Check,Search} from 'lucide-react';
import {catalog,type Issue} from '../lib/catalog';
import type {Vault} from '../lib/vault';
import ComicPicker from './comic-picker';
import {issueIdentity,listingDirectoryId} from '../lib/shared-catalog';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import {collectionGrade,ownershipFromForm,rawConditions,collectionGrades,slabLabels} from '../lib/collection-entry';

type Props={vault:Vault;commit:(vault:Vault)=>Promise<boolean>;saving:boolean;onSaved:()=>void};
function EntryMode({manual,setManual,disabled}:{manual:boolean;setManual:(value:boolean)=>void;disabled:boolean}){
 return <div className="comic-entry-mode" role="group" aria-label="Comic entry method"><button type="button" aria-pressed={!manual} disabled={disabled} className={!manual?'selected':''} onClick={()=>setManual(false)}><Search size={15}/> Find in directory</button><button type="button" aria-pressed={manual} disabled={disabled} className={manual?'selected':''} onClick={()=>setManual(true)}><BookOpen size={15}/> Unlisted comic</button></div>;
}
function ManualFields({title='',issue=''}:{title?:string;issue?:string}){return <div className="manual-comic-fields"><p className="picker-manual-note">A personal record. You can link the exact directory issue later; no FMV match is inferred.</p><label>Series title<input name="title" defaultValue={title} placeholder="e.g. Amazing Spider-Man" maxLength={160} required/></label><label>Issue / edition<input name="issue" defaultValue={issue} placeholder="e.g. #300 · second printing" maxLength={40} required/></label></div>}

export default function AddComicForm({vault,commit,saving,onSaved}:Props){
 const [selected,setSelected]=useState<Issue|null>(null),[manual,setManual]=useState(false),[error,setError]=useState('');
 return <div className="form-dialog collection-comic-form"><div className="eyebrow">YOUR PERSONAL LONGBOX</div><h2>ADD YOUR<br/><span>NEXT CHAPTER.</span></h2><form onSubmit={async event=>{
  event.preventDefault();setError('');if(!manual&&!selected){setError('Choose an issue from the directory, or select Unlisted comic.');return}
  const data=new FormData(event.currentTarget),id=crypto.randomUUID();
  const copy={id,title:manual?String(data.get('title')).trim():selected!.title,issue:manual?String(data.get('issue')).trim():'#'+selected!.number,grade:String(data.get('grade')||'').trim(),price:Number(data.get('price')),...(!manual?issueIdentity(selected!):{})};
  if(await commit({...vault,books:[...vault.books,copy],tradeBookIds:data.get('trade')?[...vault.tradeBookIds,id]:vault.tradeBookIds}))onSaved();
 }}><fieldset className="comic-form-fields" disabled={saving}>
  <EntryMode manual={manual} disabled={saving} setManual={value=>{setManual(value);setSelected(null);setError('')}}/>
  {manual?<ManualFields/>:<ComicPicker value={selected} disabled={saving} onChange={issue=>{setSelected(issue);setError('')}}/>}
  <label>Condition / grading<input name="grade" placeholder="e.g. Raw VF or CGC 9.8 Universal" maxLength={80}/></label>
  <label>Your own estimated value (USD)<input name="price" type="number" min="0" max="10000000" step="0.01" defaultValue="0" required/></label>
  <label className="check-label"><input type="checkbox" name="trade" disabled={saving}/> I would consider trading this comic</label><p className="data-caption">Your estimate is private and is not used as FMV. Each saved entry represents one physical copy.</p>
  {error&&<p className="comic-entry-error" role="alert">{error}</p>}<button className="button red" disabled={saving||!manual&&!selected}>Save to my collection <Check size={16}/></button>
 </fieldset></form></div>;
}

export function OwnedComicForm({vault,bookId,commit,saving,listed,onSaved}:Props&{bookId:string;listed:boolean}){
 const copy=vault.books.find(book=>book.id===bookId)!;
 const [format,setFormat]=useState<'RAW'|'GRADED'>(copy.ownership?.format||'RAW');
 const [selected,setSelected]=useState<Issue|null>(copy.catalogId!==undefined?catalog[copy.catalogId]??null:null),[manual,setManual]=useState(copy.catalogId===undefined&&!copy.externalCatalog),[unlink,setUnlink]=useState(false),[error,setError]=useState('');
 const linkedLookup=useRef(0);
 useEffect(()=>{if(!copy.externalCatalog)return;const lookup=++linkedLookup.current,controller=new AbortController(),directoryId=listingDirectoryId(copy);let active=true;void fetch('/api/catalog?id='+directoryId,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const page=parseCatalogSearchPage(await r.json());if(!page.issues[0]||page.issues[0].id!==directoryId)throw Error();return page.issues[0]}).then(issue=>{if(active&&linkedLookup.current===lookup)setSelected(issue)}).catch(()=>{if(active&&linkedLookup.current===lookup){setManual(true);setError('The linked source record is not in the shared directory yet. You can keep this copy as a personal record.')}});return()=>{active=false;controller.abort()}},[copy.id]);
 return <div className="form-dialog collection-comic-form"><div className="eyebrow">YOUR ACTUAL COPY / YOUR OWN ESTIMATE</div><h2>THE DETAILS<br/><span>MATTER.</span></h2><p>{copy.title} {copy.issue}</p><form onSubmit={async event=>{
  event.preventDefault();setError('');if(listed){setError('Withdraw or cancel the active listing before changing this copy’s recorded details.');return}if(!manual&&!selected){setError('Choose the exact directory issue or select Unlisted comic.');return}
  const data=new FormData(event.currentTarget),{catalogId:previous,externalCatalog:previousExternal,...own}=copy;void previous;
  const title=manual?String(data.get('title')).trim():selected!.title,issue=manual?String(data.get('issue')).trim():'#'+selected!.number;
  const identity=!manual?issueIdentity(selected!):previousExternal&&!unlink&&title===copy.title&&issue===copy.issue?{externalCatalog:previousExternal}:{};
  let ownership=copy.ownership;try{if(ownership)ownership=ownershipFromForm(data,format)}catch{setError('Check the recorded condition, grade, certification, purchase price and acquisition date.');return}
  const updated={...own,title,issue,grade:ownership?collectionGrade(ownership):String(data.get('grade')||'').trim(),price:Number(data.get('price')),...identity,...(ownership?{ownership}:{})};
  if(await commit({...vault,books:vault.books.map(book=>book.id===bookId?updated:book)}))onSaved();
 }}><fieldset className="comic-form-fields" disabled={saving||listed}>
  {listed&&<p className="comic-entry-error">This copy is included in an active listing. Withdraw or cancel that listing before editing its details.</p>}
  <EntryMode manual={manual} disabled={saving||listed} setManual={value=>{linkedLookup.current++;setManual(value);setUnlink(value);setSelected(null);setError('')}}/>
  {manual?<ManualFields title={copy.title} issue={copy.issue}/>:<ComicPicker value={selected} disabled={saving||listed} onChange={issue=>{linkedLookup.current++;setSelected(issue);setError('')}}/>}
  {copy.ownership?<><label>Copy format<select value={format} onChange={event=>setFormat(event.target.value as 'RAW'|'GRADED')}><option value="RAW">Raw / ungraded</option><option value="GRADED">CGC graded</option></select></label>{format==='RAW'?<label>Owner-stated condition<select name="rawCondition" defaultValue={copy.ownership.rawCondition||''}><option value="">Condition not recorded</option>{rawConditions.map(value=><option value={value} key={value}>{value.replaceAll('_',' ')}</option>)}</select></label>:<><label>CGC grade<select name="grade" defaultValue={copy.ownership.grade||''} required><option value="" disabled>Select grade</option>{collectionGrades.map(value=><option key={value}>{value}</option>)}</select></label><label>Label<select name="labelType" defaultValue={copy.ownership.labelType||'Universal'}>{slabLabels.map(value=><option key={value}>{value}</option>)}</select></label><label>Certification number<input name="certificationNumber" inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} defaultValue={copy.ownership.certificationNumber||''} required/></label></>}<label>Purchase price (USD, optional)<input name="purchasePrice" inputMode="decimal" defaultValue={copy.ownership.purchasePriceCents===null?'':(Number(copy.ownership.purchasePriceCents)/100).toFixed(2)}/></label><label>Acquired on<input name="acquiredOn" type="date" defaultValue={copy.ownership.acquiredOn||''}/></label><label>Private ownership notes<textarea name="notes" maxLength={500} defaultValue={copy.ownership.notes}/></label><p className="data-caption">Certification details are owner stated. Purchase details and notes stay private.</p></>:<label>Condition / grading<input name="grade" maxLength={80} defaultValue={copy.grade} placeholder="e.g. Raw VF or CGC 9.8 Universal" required disabled={listed}/></label>}
  <label>Your private estimate (USD)<input name="price" type="number" min="0" max="10000000" step="0.01" defaultValue={copy.price} required disabled={listed}/></label>
  <p className="data-caption">Choose the exact issue, year and edition. Your personal estimate stays private and never becomes FMV.</p>
  {error&&<p className="comic-entry-error" role="alert">{error}</p>}<button className="button red" disabled={saving||listed||!manual&&!selected}>Save comic details <Check size={16}/></button>
 </fieldset></form></div>;
}
