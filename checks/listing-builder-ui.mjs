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
const form=()=>fixture.find(node=>node.type==='form');await form().props.onSubmit({preventDefault(){}});await fixture.flush();await form().props.onSubmit({preventDefault(){}});await fixture.flush();await form().props.onSubmit({preventDefault(){}});await fixture.flush();assert.equal(published.length,1);assert.equal(published[0].kind,'collection');assert.equal(published[0].bookIds.length,2);assert.equal(new Set(published[0].bookIds).size,2);assert.equal(commits[0].books.length,2);assert.deepEqual(commits[0].books.map(book=>book.id),vault.books.map(book=>book.id));assert.deepEqual(commits[0].books.map(book=>book.price),[12,28]);assert.equal(published[0].price,7500);assert.deepEqual(created,{id:'isolated-listing',type:'fixed'});assert.equal(storage.has('comichuddle-listing-v1:isolated-ui-qa'),false);
console.log('PASS actual builder: multi-copy publish and draft cleanup do not wait for unavailable AI/cover providers');fixture.unmount();
