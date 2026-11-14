// Realistic phone-photo barcode fixtures through the actual decode code paths.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {barcodePhotos,type BarcodePhoto} from './fixtures/barcode-photos';
import {decodeBarcodePixels} from '../lib/barcode-reader';
import {photoDecodePlan} from '../lib/barcode-scan-plan';
import {decodeBarcodePhoto} from '../lib/barcode-photo-decode';

let photos:BarcodePhoto[]=[];
before(async()=>{photos=await barcodePhotos(20)});
async function rgba(bytes:Buffer,maxSide:number,region?:{left:number;top:number;width:number;height:number}){
 let image=sharp(await sharp(bytes).rotate().toBuffer());if(region)image=image.extract(region);
 const {data,info}=await image.resize({width:maxSide,height:maxSide,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 return {width:info.width,height:info.height,data:new Uint8ClampedArray(data)};
}

test('diagnostic: the previous upload path (one 1500px decode) on realistic photos',async()=>{
 let read=0,withSupplement=0;
 for(const photo of photos){const result=decodeBarcodePixels({...await rgba(photo.bytes,1500),rotations:2});if(result?.value.endsWith(photo.value.slice(1))||result?.value===photo.value)read++;if(result?.supplement===photo.supplement)withSupplement++}
 console.log(`previous path: ${read}/${photos.length} read, ${withSupplement} with supplement`);
});

const matches=(photo:BarcodePhoto,value:string)=>value===photo.value||value==='0'+photo.value;
test('device plan: tiled native-resolution regions (same plan the browser runs)',async()=>{
 let read=0,withSupplement=0,attempts=0;const started=Date.now();
 for(const photo of photos){
  const upright=await sharp(photo.bytes).rotate().toBuffer(),meta=await sharp(upright).metadata();let hit=null;
  for(const region of photoDecodePlan(meta.width!,meta.height!)){
   attempts++;
   const {data,info}=await sharp(upright).extract({left:region.x,top:region.y,width:region.width,height:region.height}).resize({width:Math.round(region.width*region.scale),height:Math.round(region.height*region.scale)}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   hit=decodeBarcodePixels({width:info.width,height:info.height,data:new Uint8ClampedArray(data),rotations:region.rotations,sharpen:region.sharpen});if(hit)break;
  }
  if(hit&&matches(photo,hit.value))read++;if(hit?.supplement===photo.supplement)withSupplement++;
  if(!hit)console.log('device plan missed',photo.name);else if(!matches(photo,hit.value))console.log('device plan MISREAD',photo.name,hit.value,hit.format,'expected',photo.value);
 }
 console.log(`device plan: ${read}/${photos.length} read, ${withSupplement} with supplement, ${attempts} attempts, ${Date.now()-started}ms`);
 assert.ok(read/photos.length>=.8,`device decode rate ${read}/${photos.length}`);
});

test('server decode (sharp: EXIF, normalise, multi-scale, tiles) reads the photos the device plan missed; combined >= 90%',async()=>{
 let device=0,combined=0,supplements=0;const started=Date.now();
 for(const photo of photos){
  const upright=await sharp(photo.bytes).rotate().toBuffer(),meta=await sharp(upright).metadata();let hit=null;
  for(const region of photoDecodePlan(meta.width!,meta.height!,{maxPixels:3_000_000})){
   const {data,info}=await sharp(upright).extract({left:region.x,top:region.y,width:region.width,height:region.height}).resize({width:Math.round(region.width*region.scale),height:Math.round(region.height*region.scale)}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   hit=decodeBarcodePixels({width:info.width,height:info.height,data:new Uint8ClampedArray(data),rotations:region.rotations,sharpen:region.sharpen});if(hit)break;
  }
  if(hit&&matches(photo,hit.value))device++;
  else{const server=await decodeBarcodePhoto(photo.bytes);hit=server.code;if(!hit)console.log('server also missed',photo.name)}
  if(hit&&matches(photo,hit.value))combined++;if(hit?.supplement===photo.supplement)supplements++;
 }
 console.log(`device ${device}/${photos.length}; device+server ${combined}/${photos.length}; supplement read ${supplements}; ${Date.now()-started}ms`);
 assert.ok(combined/photos.length>=.9,`combined decode rate ${combined}/${photos.length}`);
});

test('POST /api/recognition/decode returns digits only and rejects non-images',async()=>{
 const {POST}=await import('../app/api/recognition/decode/route');
 const photo=photos.find(p=>p.name.includes('exif6'))||photos[2];
 const response=await POST(new Request('http://local.test/api/recognition/decode',{method:'POST',headers:{'content-type':'image/jpeg'},body:new Uint8Array(photo.bytes)}));
 const body=await response.json();assert.equal(response.status,200);
 if(body.found){assert.ok(matches(photo,body.value));assert.equal(typeof body.supplement,'string')}
 console.log('decode route on',photo.name,'->',body.found?body.value+' '+body.supplement:'not found',body.elapsedMs+'ms');
 const wrong=await POST(new Request('http://local.test/api/recognition/decode',{method:'POST',headers:{'content-type':'text/plain'},body:'hello'}));assert.equal(wrong.status,415);
 const junk=await POST(new Request('http://local.test/api/recognition/decode',{method:'POST',headers:{'content-type':'image/jpeg'},body:new Uint8Array([1,2,3,4])}));assert.equal(junk.status,415);
});
