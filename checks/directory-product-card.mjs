// Actual product card helpers/hooks and form callbacks with controlled inputs.
// This is not rendered DOM, native dialog focus or hosted account E2E.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReporter, loadTypeScriptModule, plain} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';

const report=createReporter('Directory React/Tailwind product card');
const module=loadTypeScriptModule('architecture/postgres/ui/ComicProductCard.tsx');
const now=Date.now(), id=randomUUID();
const raw={directoryComicId:id,amountCents:'12000',currency:'USD',format:'RAW',rawCondition:'NEAR_MINT',
  gradingCompany:null,grade:null,labelType:null,sourceName:'Synthetic public source',observedAt:new Date(now-3600000).toISOString(),
  expiresAt:new Date(now+86400000).toISOString(),displayPermitted:true,comparableAttributesKey:'STANDARD'};
const graded={...raw,amountCents:'40000',format:'GRADED',rawCondition:null,gradingCompany:'CGC',grade:'9.8',labelType:'UNIVERSAL',comparableAttributesKey:'CGC_WHITE_NO_PREMIUM'};
const base={id,title:'QA Exact Edition',issueNumber:'1',publisher:'QA Press',year:1988,variantTags:['First printing'],
  coverUrl:'/covers/planet-12.jpg',coverDisplayAllowed:true,catalogStatus:'CANONICAL',activeListingCount:null,
  valuationStatus:'AVAILABLE',rawQuote:raw,cgc98Quote:graded};
const fixture=options=>createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',
  props:{comic:base,onAddToCollection:async()=>{},...options}});
const submit=async(f,fields)=>{const form=f.find(node=>node.type==='form');assert.ok(form,'Actual collection form missing');
  const promise=form.props.onSubmit({preventDefault(){},currentTarget:fields});await f.flush();return promise;};
const data={rawCondition:'FINE',purchasePrice:'12.34',acquiredOn:'2026-10-12',notes:'PRIVATE_OWNER_NOTE',
  grade:'9.8',labelType:'Universal',certificationNumber:'1234567890'};

await report.test('Raw and CGC9.8 helpers select distinct exact current licensed comparable amounts',async()=>{
  assert.equal(module.cardFmv(base,'RAW',now).amountCents,'12000');assert.equal(module.cardFmv(base,'CGC98',now).amountCents,'40000');
  assert.equal(module.cardFmv({...base,catalogStatus:'PROVISIONAL'},'RAW',now),null);
});
await report.test('Invalid identity, stale/future/unauthorized money and wrong label/grade/premium cannot display FMV',async()=>{
  for(const changes of [{directoryComicId:randomUUID()},{amountCents:'0'},{amountCents:'-1'},{amountCents:'NaN'},
    {amountCents:'100000000001'},{amountCents:'123.4'},{displayPermitted:false},{currency:'EUR'},
    {observedAt:new Date(now+1).toISOString()},{expiresAt:new Date(now).toISOString()},{rawCondition:'VERY_FINE'},
    {comparableAttributesKey:'UNKNOWN'}])assert.equal(module.cardFmv({...base,rawQuote:{...raw,...changes}},'RAW',now),null);
  for(const changes of [{grade:'9.6'},{gradingCompany:'CBCS'},{labelType:'Signature Series'},
    {comparableAttributesKey:'CGC_OW_NO_PREMIUM'}])assert.equal(module.cardFmv({...base,cgc98Quote:{...graded,...changes}},'CGC98',now),null);
});
await report.test('Actual toggles change displayed amount and exact selected condition without relabeling Raw asCGC',async()=>{
  const f=fixture();await f.flush();assert.match(f.snapshot(),/\$120\.00/);assert.match(f.snapshot(),/Raw Near Mint/);
  await f.click('CGC 9.8 FMV');assert.match(f.snapshot(),/\$400\.00/);assert.match(f.snapshot(),/CGC 9.8 Universal/);
  await f.click('Raw FMV');assert.match(f.snapshot(),/\$120\.00/);f.unmount();
});
await report.test('An already-visible quote expires to unavailable through the actual timer and unsafe marketplace links use exact identity fallback',async()=>{
  const f=createScannerFixture({now,componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props:{comic:{...base,rawQuote:{...raw,expiresAt:new Date(now+1000).toISOString()}},onAddToCollection:async()=>{}}});
  await f.flush();assert.match(f.snapshot(),/\$120\.00/);await f.advance(1000);assert.match(f.snapshot(),/Value unavailable/);assert.ok(!f.snapshot().includes('$120.00'));f.unmount();
  for(const href of ['javascript:alert(1)','https://outside.example','//outside.example','/\\outside.example','/path with space'])assert.equal(module.marketplaceAddress(href,id),'/marketplace?comic='+encodeURIComponent(id));
  assert.equal(module.marketplaceAddress('/?section=Marketplace&issue=24',id),'/?section=Marketplace&issue=24');
});
await report.test('Unavailable/provisional values and unknown/zero/positive copy counts retain honest actions',async()=>{
  for(const [count,expected] of [[null,'check availability'],[0,'No active copies'],[2,'Browse 2 active listings']]){
    const f=fixture({comic:{...base,valuationStatus:'COMING_SOON',rawQuote:null,cgc98Quote:null,activeListingCount:count}});await f.flush();
    assert.match(f.snapshot(),/Coming soon/);assert.ok(f.snapshot().includes(expected));assert.ok(!f.snapshot().includes('$0.00'));f.unmount();
  }
  const custom=fixture({comic:{...base,catalogStatus:'PROVISIONAL'}});await custom.flush();assert.match(custom.snapshot(),/under review/);
  assert.match(custom.snapshot(),/No verified FMV or purchase/);assert.ok(!custom.snapshot().includes('$120.00'));custom.unmount();
});
await report.test('Cover permission and URL filtering suppress unsafe or unlicensed image sources',async()=>{
  for(const address of ['javascript:alert(1)','http://bad.test/image.jpg','//bad.test/image.jpg'])assert.equal(module.coverAddress(address),null);
  assert.equal(module.coverAddress('/covers/planet-12.jpg'),'/covers/planet-12.jpg');
  for(const comic of [{...base,coverDisplayAllowed:false},{...base,coverUrl:'javascript:alert(1)'}]){
    const f=fixture({comic});await f.flush();assert.equal(f.find(node=>node.type==='img'),undefined);assert.match(f.snapshot(),/Cover unavailable/);f.unmount();
  }
});
await report.test('Authentication gate can stop opening a collection dialog before any callback',async()=>{
  let writes=0;const f=fixture({beforeCollection:()=>false,onAddToCollection:async()=>writes++});await f.flush();await f.click('Add to Collection');
  assert.equal(f.find(node=>node.type==='form'),undefined);assert.equal(writes,0);assert.equal(f.calls.modalOpened,0);f.unmount();
});
await report.test('Raw form saves one exact directory identity, integer-cent cost and private ownership details',async()=>{
  const writes=[],f=fixture({onAddToCollection:async(...args)=>writes.push(args)});await f.flush();await f.click('Add to Collection');
  await submit(f,data);assert.equal(writes.length,1);assert.equal(writes[0][0],id);
  assert.deepEqual(plain(writes[0][1]),{format:'RAW',rawCondition:'FINE',gradingCompany:null,grade:null,labelType:null,
    certificationNumber:null,purchasePriceCents:'1234',acquiredOn:'2026-10-12',notes:'PRIVATE_OWNER_NOTE'});
  assert.match(writes[0][2],/^[0-9a-f-]{36}$/);assert.match(f.snapshot(),/Saved one copy/);assert.ok(!f.snapshot().includes('PRIVATE_OWNER_NOTE'));f.unmount();
});
await report.test('CGC form requires certificate and stores stated grade/label separately from quotedFMV',async()=>{
  const writes=[],f=fixture({onAddToCollection:async(...args)=>writes.push(args)});await f.flush();await f.click('Add to Collection');
  f.find(node=>node.type==='select'&&node.props.name==='format').props.onChange({target:{value:'GRADED'}});await f.flush();
  await submit(f,{...data,certificationNumber:'abc'});assert.equal(writes.length,0);assert.match(f.snapshot(),/Check the condition/);
  await submit(f,data);assert.equal(writes.length,1);assert.equal(writes[0][1].grade,'9.8');assert.equal(writes[0][1].labelType,'Universal');
  assert.equal(writes[0][1].certificationNumber,'1234567890');assert.equal(writes[0][1].rawCondition,null);assert.equal(writes[0][1].purchasePriceCents,'1234');
  assert.match(f.snapshot(),/\$120\.00/);f.unmount();
});
await report.test('Blank/zero cost remain distinct and invalid dates/prices cannot dispatch a write',async()=>{
  const writes=[],f=fixture({onAddToCollection:async(...args)=>writes.push(args)});await f.flush();await f.click('Add to Collection');
  for(const fields of [{...data,purchasePrice:'-1'},{...data,purchasePrice:'1.234'},{...data,acquiredOn:'2026-02-30'}])await submit(f,fields);
  assert.equal(writes.length,0);await submit(f,{...data,purchasePrice:'',acquiredOn:''});assert.equal(writes[0][1].purchasePriceCents,null);
  await f.click('Add to Collection');await submit(f,{...data,purchasePrice:'0'});assert.equal(writes[1][1].purchasePriceCents,'0');f.unmount();
});
await report.test('Pending save suppresses duplicates and all close paths until the request completes',async()=>{
  const writes=[];let resolve;const f=fixture({onAddToCollection:(...args)=>{writes.push(args);return new Promise(done=>{resolve=done;});}});
  await f.flush();await f.click('Add to Collection');const form=f.find(node=>node.type==='form');
  const event={preventDefault(){},currentTarget:data},pending=form.props.onSubmit(event);await f.flush();form.props.onSubmit(event);await f.flush();assert.equal(writes.length,1);
  const dialog=f.find(node=>node.type==='dialog');let cancelled=false;dialog.props.onCancel({preventDefault(){cancelled=true;}});
  dialog.props.onClick({target:dialog,currentTarget:dialog});f.button('×').props.onClick();await f.flush();assert.ok(f.find(node=>node.type==='form'));assert.equal(cancelled,true);
  resolve();await pending;await f.flush();assert.equal(f.find(node=>node.type==='form'),undefined);assert.match(f.snapshot(),/Saved one copy/);f.unmount();
});
await report.test('A failed retry retains its requestUUID, changed details use a fresh UUID and unmount ignores late completion',async()=>{
  const writes=[];let mode='reject',resolve;const f=fixture({onAddToCollection:(...args)=>{writes.push(args);return mode==='reject'?Promise.reject(Error('Retryable storage failure')):new Promise(done=>{resolve=done;});}});
  await f.flush();await f.click('Add to Collection');await submit(f,data);assert.match(f.snapshot(),/Retryable storage failure/);
  await submit(f,data);assert.equal(writes[0][2],writes[1][2]);await submit(f,{...data,notes:'different details'});assert.notEqual(writes[1][2],writes[2][2]);
  mode='pending';const form=f.find(node=>node.type==='form'),pending=form.props.onSubmit({preventDefault(){},currentTarget:data});await f.flush();
  const snapshot=f.snapshot();f.unmount();resolve();await pending;await f.flush();assert.equal(f.snapshot(),snapshot);
});
const badgeModule=loadTypeScriptModule('architecture/postgres/ui/DealWarningBadge.tsx');
const evidence={source:'Synthetic public source',kind:'SALE_BASELINE',observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString(),sampleCount:12,methodology:'Public synthetic method'};
const deal={schemaVersion:'1.0',modelVersion:'price-data-heuristic-v1',riskKind:'PRICE_DATA_CAUTION',riskScore:20,
  coveragePercent:100,baselineCents:'20000',variancePercent:-20,isCustomEntry:false,position:'BELOW_MARKET',
  items:[{quoteState:'PRICED',evidence}],warnings:['Inspect edition and condition.']};
await report.test('Deal caution uses static enum presentation and stale/partial/custom/invalid inputs become Unknown',async()=>{
  assert.equal(badgeModule.dealPresentation(deal,now).position,'BELOW_MARKET');
  for(const value of [{...deal,coveragePercent:50},{...deal,isCustomEntry:true},{...deal,baselineCents:null},
    {...deal,position:'__proto__'},{...deal,riskScore:-1},{...deal,modelVersion:'untrusted'},
    {...deal,items:[{quoteState:'PRICED',evidence:{...evidence,kind:'EDITORIAL_ESTIMATE'}}]}]){
    const result=badgeModule.dealPresentation(value,now);assert.equal(result.position,'UNKNOWN');assert.ok(result.score>=60);
  }
  assert.equal(badgeModule.dealPresentation(deal,now+1000).position,'UNKNOWN');
});
await report.test('Deal warning HTML is escaped as text and carries no seller/security guarantee',async()=>{
  const html=renderToStaticMarkup(React.createElement(badgeModule.default,{analysis:{...deal,warnings:['<img src=x onerror=alert(1)>']}}));
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.match(html,/does not authenticate/);
  assert.ok(!html.includes('Secure Deal'));assert.ok(!html.includes('dangerouslySetInnerHTML'));
});
await report.test('Visible caution expires to Unknown through the actual component timer',async()=>{
  const f=createScannerFixture({now,componentFile:'architecture/postgres/ui/DealWarningBadge.tsx',props:{analysis:deal}});
  await f.flush();assert.match(f.snapshot(),/Below FMV/);await f.advance(1000);assert.match(f.snapshot(),/FMV unavailable/);
  assert.match(f.snapshot(),/60\/100/);f.unmount();
});
report.finish({browserE2E:'NOT EXECUTED',dialogFocusHardware:'NOT EXECUTED',genuineProviderCalls:0,paymentExecutions:0});
