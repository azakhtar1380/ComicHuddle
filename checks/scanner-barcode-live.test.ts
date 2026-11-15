// Controlled hooks run of the real scanner component: mocked camera, native
// BarcodeDetector and fetch. Not a browser, device camera or real decode test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error untyped QA fixture module
import {createScannerFixture} from './scanner-hooks.mjs';
import {catalog} from '../lib/catalog';
import {catalogSearchDto} from '../lib/catalog-search';

const issue=catalog[0];
function detectorReturning(values:{rawValue:string;format:string}[][]){
 let call=0;const seen:number[]=[];
 class BarcodeDetector{static async getSupportedFormats(){return ['upc_a','upc_e','ean_13','ean_8','code_128']}async detect(){seen.push(call);return values[Math.min(call++,values.length-1)]}}
 return {BarcodeDetector,seen};
}
async function startLive(fixture:any){await fixture.flush();await fixture.click('Scan barcode');const live=fixture.stream();fixture.calls.cameras.at(-1).resolve(live);await fixture.flush();return live}

test('live barcode loop: base code waits briefly for an add-on, then looks up -> "Found" with confirm, camera stopped, no OCR',async()=>{
 const {BarcodeDetector}=detectorReturning([[{rawValue:'036000291452',format:'upc_a'}]]);
 const fixture=createScannerFixture({globals:{window:{addEventListener(){},removeEventListener(){},BarcodeDetector},navigator:{mediaDevices:{getUserMedia:(settings:unknown)=>new Promise((resolve,reject)=>fixture.calls.cameras.push({options:settings,resolve,reject}))},vibrate(){vibrated++}}},
  fetcher:async(url:string)=>{assert.match(url,/^\/api\/recognition\/barcode\?/);return Response.json({issues:[catalogSearchDto(issue)],hasMore:false,notice:'The supplement was included.',external:[],match:'exact'})}});
 let vibrated=0;
 const live=await startLive(fixture);
 const camera=fixture.calls.cameras[0].options;assert.equal(camera.video.facingMode.ideal,'environment');assert.equal(camera.video.width.ideal,1920);assert.equal(camera.audio,false);
 for(let i=0;i<6&&!/Found it by barcode/.test(fixture.status());i++){await fixture.advance(400);await fixture.flush()}
 await fixture.waitFor(()=>/Found it by barcode/.test(fixture.status()),'barcode match');
 assert.match(fixture.status(),/The supplement was included./);assert.ok(fixture.snapshot().includes(issue.title),'matched issue shown');assert.match(fixture.snapshot(),/Is this your comic?/);
 assert.ok(fixture.button('Yes, add to my collection'));assert.equal(live.track.stops,1);assert.equal(vibrated,1);
 const urls=fixture.calls.requests.map((request:{url:string})=>request.url);
 assert.equal(urls.length,1);assert.match(urls[0],/value=036000291452&supplement=&format=upc_a/);
 assert.ok(!urls.some((url:string)=>url.startsWith('/api/catalog')),'no OCR/catalog text search in the live loop');
 fixture.unmount();
});

test('no barcode in view: loop keeps polling quietly and never opens manual search or OCR',async()=>{
 const {BarcodeDetector,seen}=detectorReturning([[]]);
 const fixture=createScannerFixture({globals:{window:{addEventListener(){},removeEventListener(){},BarcodeDetector}}});
 const live=await startLive(fixture);
 for(let i=0;i<6;i++){await fixture.advance(400);await fixture.flush()}
 assert.ok(seen.length>=3,'decoded several frames, got '+seen.length);
 assert.equal(fixture.calls.requests.length,0);assert.equal(live.track.stops,0);
 assert.equal(fixture.find((node:any)=>typeof node.type==='function'&&node.type.name==='ComicPicker'),undefined);
 assert.match(fixture.snapshot(),/LOOKING FOR A BARCODE/);
 await fixture.click('Stop camera');assert.equal(live.track.stops,1);
 const before=seen.length;await fixture.advance(2000);await fixture.flush();assert.equal(seen.length,before,'loop stops with the camera');
 fixture.unmount();
});

test('unknown barcode with a Metron-only record shows the external candidate and prefills search',async()=>{
 const {BarcodeDetector}=detectorReturning([[{rawValue:'0425261412',format:'upc_e'}]]);
 const fixture=createScannerFixture({globals:{window:{addEventListener(){},removeEventListener(){},BarcodeDetector}},
  fetcher:async()=>Response.json({issues:[],hasMore:false,notice:'',match:'none',metron:{status:'external'},external:[{metronId:9,title:'Modern Book',number:'5',publisher:'QA',year:2024,cover:'https://static.metron.cloud/media/x.jpg',coverCredit:'Cover © publisher · image via Metron',sourceUrl:'https://metron.cloud/issue/modern-book-5/',upc:'',dataCredit:'Issue data: Metron (metron.cloud), CC BY-SA 4.0'}]})});
 await startLive(fixture);await fixture.advance(300);await fixture.flush();
 await fixture.waitFor(()=>/Metron knows this barcode/.test(fixture.status()),'external candidate');
 assert.match(fixture.snapshot(),/Found on Metron/);assert.ok(fixture.button('Find in directory'));
 const picker=fixture.find((node:any)=>typeof node.type==='function'&&node.type.name==='ComicPicker');assert.equal(picker?.props.initialQuery,'Modern Book #5');
 fixture.unmount();
});

test('uploaded photo: each step is shown; AI out of free quota falls through to cover text silently',async()=>{
 const seen:string[]=[];
 const fixture=createScannerFixture({fetcher:async(url:string,options:{method?:string}={})=>{
  seen.push((options.method||'GET')+' '+url.split('?')[0]);
  if(url==='/api/recognition/decode')return Response.json({found:false,attempts:12,elapsedMs:900});
  if(url==='/api/recognition/identify'&&options.method!=='POST')return Response.json({available:true,provider:'gemini'});
  if(url==='/api/recognition/identify')return Response.json({status:'unavailable',reason:'quota',provider:'gemini'});
  return Response.json({issues:[],total:0,limit:12,offset:0,hasMore:false,issueCount:0,scope:'shared'});
 }});
 await fixture.flush();await fixture.upload({type:'image/jpeg',size:500});
 let sawOcr=false;
 for(let i=0;i<60&&!(sawOcr&&!/Matching your cover…$/.test(fixture.status()));i++){await fixture.flush();await new Promise(resolve=>setTimeout(resolve,5));if(/Reading the cover text/.test(fixture.snapshot()))sawOcr=true}
 assert.ok(seen.includes('POST /api/recognition/decode'),'server barcode decode tried after the device');
 assert.ok(seen.includes('GET /api/recognition/identify')&&seen.includes('POST /api/recognition/identify'),'AI tried when available');
 assert.ok(sawOcr,'free cover-text step shown after AI was unavailable');
 assert.match(fixture.snapshot(),/Reading the barcode/);assert.match(fixture.snapshot(),/Checking the barcode on our server/);
 assert.doesNotMatch(fixture.snapshot(),/limit|quota|unavailable/i);
 const steps=fixture.find((node:any)=>node.type==='ol'&&node.props?.className==='scan-steps');assert.ok(steps,'step list shown');
 assert.doesNotMatch(fixture.text(steps),/Matching your cover/,'unavailable AI step removed from the list');
 fixture.unmount();
});

test('uploaded photo: AI provider off -> no identify POST, straight to cover text',async()=>{
 const seen:string[]=[];
 const fixture=createScannerFixture({fetcher:async(url:string,options:{method?:string}={})=>{seen.push((options.method||'GET')+' '+url.split('?')[0]);
  if(url==='/api/recognition/decode')return Response.json({found:false});
  if(url==='/api/recognition/identify')return Response.json({available:false,provider:'none'});
  return Response.json({issues:[],total:0,limit:12,offset:0,hasMore:false,issueCount:0,scope:'shared'})}});
 await fixture.flush();await fixture.upload({type:'image/jpeg',size:500});
 for(let i=0;i<60&&!/Reading the cover text/.test(fixture.snapshot());i++){await fixture.flush();await new Promise(resolve=>setTimeout(resolve,5))}
 assert.ok(!seen.includes('POST /api/recognition/identify'));assert.match(fixture.snapshot(),/Reading the cover text/);
 fixture.unmount();
});
