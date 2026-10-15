// Controlled-hook tests run the actual builder callbacks and JSX. They are not
// a substitute for signed-in browser, DOM validation or payment-provider E2E.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createScannerFixture} from './scanner-hooks.mjs';
import {emptyListingDraft} from '../lib/listing-draft.ts';
import {emptyVault} from '../lib/vault.ts';
import {catalog} from '../lib/catalog.ts';
const initial={...emptyListingDraft(),title:'Two collectible copies',photos:[randomUUID()],price:'75',shipping:'5',description:'Actual copies with clearly described condition.',owned:true,usa:true};
const vault=emptyVault('QA');vault.books=[{id:randomUUID(),catalogId:0,title:catalog[0].title,issue:'#'+catalog[0].number,grade:'Raw VF',price:12},{id:randomUUID(),catalogId:0,title:catalog[0].title,issue:'#'+catalog[0].number,grade:'Raw VF',price:28}];
const storage=new Map(),writes=[],commits=[],published=[];let created;
const fixture=createScannerFixture({componentFile:'app/listing-builder.tsx',globals:{localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},props:{profileId:'isolated-ui-qa',vault,reservedIds:new Set(),commit:async vault=>{commits.push(vault);return true},publish:async value=>{published.push(value);return {listingId:'isolated-listing'}},onPublished:(id,type)=>{created={id,type}},notice(){}},fetcher:async(url,options)=>{
 if(url==='/api/listing-draft'&&options.method==='PUT'){writes.push(JSON.parse(options.body));return Response.json({saved:true,revision:randomUUID()})}
 if(url==='/api/listing-draft')return Response.json({draft:initial,revision:randomUUID(),updatedAt:new Date().toISOString()});
 if(url.startsWith('/api/listing-draft?'))return Response.json({saved:true});
 if(url==='/api/estimates/compose')return Response.json({error:'Isolated provider failure'},{status:503});
 throw Error('Unexpected builder request: '+url);
}});
await fixture.flush();assert.match(fixture.text(fixture.nodes()[0]),/Saved private draft restored/);
const picker=()=>fixture.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker');assert.equal(picker().props.label,'Which comics are you selling?');assert.equal(fixture.nodes().some(node=>node.type==='button'&&['One comic','Multiple comics'].includes(fixture.text(node))),false);
picker().props.onChange(catalog[0]);await fixture.flush();picker().props.onChange(catalog[3]);await fixture.flush();assert.match(fixture.text(fixture.nodes()[0]),/2 physical copies selected/);
let quantity=fixture.find(node=>node.type==='input'&&node.props.type==='number'&&node.props.min==='1'&&node.props.value===1);quantity.props.onChange({target:{value:'2'}});await fixture.flush();assert.match(fixture.text(fixture.nodes()[0]),/3 physical copies selected/);
picker().props.onChange(catalog[0]);await fixture.flush();assert.match(fixture.text(fixture.nodes()[0]),/3 physical copies selected/); // duplicate selection never silently duplicates ownership
const second=fixture.find(node=>node.type==='button'&&node.props['aria-label']==='Remove '+catalog[3].title+' #'+catalog[3].number);assert.ok(second);second.props.onClick();await fixture.flush();assert.match(fixture.text(fixture.nodes()[0]),/2 physical copies selected/);
await fixture.advance(1100);await fixture.flush();assert.ok(writes.length);assert.equal(writes.at(-1).draft.rows.length,1);assert.equal(writes.at(-1).draft.rows[0].copyIds.length,2);assert.ok(storage.get('comichuddle-listing-v1:isolated-ui-qa'));
console.log('PASS actual builder: one dropdown, add/remove, duplicate choice, quantity, stable private autosave');
const form=()=>fixture.find(node=>node.type==='form');await form().props.onSubmit({preventDefault(){}});await fixture.flush();await form().props.onSubmit({preventDefault(){}});await fixture.flush();await form().props.onSubmit({preventDefault(){}});await fixture.flush();assert.equal(published.length,1);assert.equal(published[0].kind,'collection');assert.equal(published[0].bookIds.length,2);assert.equal(new Set(published[0].bookIds).size,2);assert.equal(commits[0].books.length,2);assert.deepEqual(Array.from(commits[0].books,book=>book.id),vault.books.map(book=>book.id));assert.deepEqual(Array.from(commits[0].books,book=>book.price),[12,28]);assert.equal(published[0].price,7500);assert.deepEqual(created,{id:'isolated-listing',type:'fixed'});assert.equal(storage.has('comichuddle-listing-v1:isolated-ui-qa'),false);
console.log('PASS actual builder: multi-copy publish and draft cleanup do not wait for unavailable AI/cover providers');fixture.unmount();

function recoveryDraft(issue){return {...emptyListingDraft(),rows:[{id:randomUUID(),issueId:issue.id,title:issue.title,issue:'#'+issue.number,publisher:issue.publisher,year:issue.year,variant:issue.variant,copyIds:[randomUUID()],condition:{}}]};}
function recoveryFixture({browser,server,firstReadFails=false,conflictOnWrite=false}){
 const values=new Map(browser?[['comichuddle-listing-v1:recovery-qa',JSON.stringify({draft:browser,updatedAt:Date.now()})]]:[]),writes=[];
 let remote=server,revision=randomUUID(),readCount=0,conflict=conflictOnWrite;
 const fixture=createScannerFixture({componentFile:'app/listing-builder.tsx',globals:{localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}},props:{profileId:'recovery-qa',vault:emptyVault('Recovery QA'),reservedIds:new Set(),commit:async()=>true,publish:async()=>{throw Error('Recovery must finish before publishing')},onPublished(){},notice(){}},fetcher:async(url,options)=>{
  if(url==='/api/listing-draft'&&options.method==='PUT'){
   const body=JSON.parse(options.body);writes.push(body);
   if(conflict){conflict=false;revision=randomUUID();remote=recoveryDraft(catalog[3]);return Response.json({error:'This draft changed in another tab. Your selection is retained.'},{status:409})}
   assert.equal(body.baseRevision,remote?revision:null);remote=body.draft;revision=randomUUID();return Response.json({saved:true,revision});
  }
  if(url==='/api/listing-draft'){readCount++;if(firstReadFails&&readCount===1)return Response.json({error:'Connection unavailable'},{status:503});return Response.json({draft:remote,revision:remote?revision:null,updatedAt:remote?'2026-10-15T01:00:00.000Z':null})}
  if(url.startsWith('/api/catalog?ids=')){const ids=url.split('=')[1].split(',').map(Number),issues=ids.map(id=>catalog.find(issue=>issue.id===id)).filter(Boolean);return Response.json({issues,total:issues.length,limit:issues.length,offset:0,hasMore:false})}
  if(url==='/api/estimates/compose')return Response.json({error:'Provider unavailable'},{status:503});
  throw Error('Unexpected recovery request '+url);
 }});
 return {fixture,writes,values,get revision(){return revision}};
}

const browserDraft=recoveryDraft(catalog[0]),oldServerDraft=recoveryDraft(catalog[3]);
const recovered=recoveryFixture({browser:browserDraft,server:oldServerDraft});await recovered.fixture.flush();
assert.ok(recovered.fixture.find(node=>node.props?.['aria-label']==='Remove '+catalog[0].title+' #'+catalog[0].number),'The browser selection survives an older server draft');
await recovered.fixture.advance(2500);assert.equal(recovered.writes.length,0,'Different drafts require a deliberate choice before any overwrite');
await recovered.fixture.click('Keep my current selection');await recovered.fixture.advance(1100);
assert.equal(recovered.writes.length,1);assert.equal(recovered.writes[0].draft.rows[0].copyIds[0],browserDraft.rows[0].copyIds[0]);
console.log('PASS actual builder: conflicting browser recovery preserves physical copy IDs and saves only after an explicit version choice');recovered.fixture.unmount();

const reconnect=recoveryFixture({browser:browserDraft,server:null,firstReadFails:true});await reconnect.fixture.flush();
assert.match(reconnect.fixture.status(),/Server draft unavailable/);await reconnect.fixture.advance(2500);assert.equal(reconnect.writes.length,0);
await reconnect.fixture.click('Review saved draft');await reconnect.fixture.click('Keep my current selection');await reconnect.fixture.advance(1100);
assert.equal(reconnect.writes.length,1);assert.equal(reconnect.writes[0].baseRevision,null);assert.equal(reconnect.writes[0].draft.rows[0].issueId,catalog[0].id);
console.log('PASS actual builder: an initial connection failure retains selection and reconnects without an insert/conflict retry loop');reconnect.fixture.unmount();

const concurrent=recoveryFixture({browser:null,server:browserDraft,conflictOnWrite:true});await concurrent.fixture.flush();
const concurrentPicker=concurrent.fixture.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker');concurrentPicker.props.onChange(catalog[7]);await concurrent.fixture.flush();await concurrent.fixture.advance(1100);
assert.equal(concurrent.writes.length,1);await concurrent.fixture.advance(16000);assert.equal(concurrent.writes.length,1,'A 409 stops automatic retries');
await concurrent.fixture.click('Review saved draft');await concurrent.fixture.click('Load saved version');await concurrent.fixture.advance(1100);
assert.equal(concurrent.writes.length,1,'Loading the server version does not write over it');assert.ok(concurrent.fixture.find(node=>node.props?.['aria-label']==='Remove '+catalog[3].title+' #'+catalog[3].number));
console.log('PASS actual builder: concurrent-tab conflicts stop retries and can restore the latest saved version');concurrent.fixture.unmount();
