import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import bwipjs from 'bwip-js';
import {catalog} from '../lib/catalog';
import {parseComicIdentifier,identifiersFromRecord} from '../lib/comic-identifiers';
import {decodeBarcodePixels} from '../lib/barcode-reader';
import {normalizeSellerPhoto} from '../lib/seller-photos';
import {reviewedLocalCover} from '../lib/reviewed-local-covers';
import {parseGcdCoverResponse,optimizeCover} from '../lib/cover-cache';
import {aiAvailability,structuredAi} from '../lib/enrichment-ai';
import {enqueueEnrichment,claimEnrichment} from '../lib/enrichment-jobs';
import {getDb} from '../db';

test('UPC/EAN aliases preserve leading zeros and supplements; ISBN10 aliases ISBN13',()=>{
 const base=parseComicIdentifier('036000291452')!,extended=parseComicIdentifier('03600029145212345')!;
 assert.equal(base.lookupKey,'0036000291452');assert.equal(extended.base,'036000291452');assert.equal(extended.supplement,'12345');assert.equal(extended.identifier,'03600029145212345');
 assert.equal(parseComicIdentifier('0036000291452')?.lookupKey,base.lookupKey);assert.equal(parseComicIdentifier('0-306-40615-2')?.lookupKey,'9780306406157');
 assert.equal(parseComicIdentifier('04252614','12','UPC_E')?.lookupKey,'0042100005264');assert.equal(parseComicIdentifier('04252614','12','UPC_E')?.identifier,'0425261412');assert.equal(parseComicIdentifier('036000291451'),null);assert.equal(parseComicIdentifier('036000291452','1234'),null);assert.equal(identifiersFromRecord({barcode:'036000291452; 03600029145212345'}).length,2);
});
test('actual fallback decoder recognizes a generated UPC at two orientations without BarcodeDetector or an AI model',async()=>{
 const image=await bwipjs.toBuffer({bcid:'upca',text:'036000291452',scale:3,height:18,paddingwidth:16,paddingheight:12});
 for(const rotation of [0,90]){const {data,info}=await sharp(image).rotate(rotation).ensureAlpha().raw().toBuffer({resolveWithObject:true});const result=decodeBarcodePixels({width:info.width,height:info.height,data:new Uint8ClampedArray(data)});assert.ok(result);assert.equal(parseComicIdentifier(result.value,result.supplement)?.lookupKey,'0036000291452')}
});
test('seller photos are decoded, rotated, normalized and thumbnailed; HTML and corrupt containers are rejected',async()=>{
 const bytes=await sharp({create:{width:600,height:900,channels:3,background:'#dbb746'}}).jpeg().toBuffer(),photo=await normalizeSellerPhoto(bytes);
 assert.equal(photo.contentType,'image/webp');assert.equal((await sharp(photo.bytes).metadata()).format,'webp');assert.equal((await sharp(photo.thumbnail).metadata()).width,427);assert.equal(photo.width,600);assert.match(photo.hash,/^[a-f0-9]{64}$/);
 await assert.rejects(normalizeSellerPhoto(Buffer.from('<html>200 access denied</html>')));await assert.rejects(normalizeSellerPhoto(bytes.subarray(0,80)));await assert.rejects(optimizeCover(Buffer.from('<html>challenge</html>'),'text/html'));
});
test('reviewed local art matches exact native IDs and metadata, never another edition',()=>{
 const issue={...catalog[24],id:4000001400,gcdId:1400,cover:undefined};assert.equal(reviewedLocalCover(issue).cover,'/covers/planet-12.jpg');
 assert.equal(reviewedLocalCover({...issue,id:4000001401,gcdId:1401}).cover,undefined);assert.equal(reviewedLocalCover({...issue,variant:'Facsimile'}).cover,undefined);assert.equal(reviewedLocalCover({...issue,year:2025}).cover,undefined);
 assert.equal(parseGcdCoverResponse({api_url:'https://www.comics.org/api/issue/1400/',cover:''},1400).confirmedAbsent,true);assert.throws(()=>parseGcdCoverResponse({api_url:'https://www.comics.org/api/issue/1401/',cover:''},1400));
});
test('deferred FMV/Pulse routes and producers do not access a database or provider',async()=>{
 const db=getDb();await enqueueEnrichment(db,'valuation','retired',{});await enqueueEnrichment(db,'pulse','retired',{});assert.equal(await claimEnrichment(db,'valuation'),null);
 assert.equal((await aiAvailability()).available,false);await assert.rejects(structuredAi(db,'scanner',{},'',''),/ai_deferred_for_launch/);
 for(const file of ['../app/api/estimates/route','../app/api/estimates/compose/route','../app/api/values/route','../app/api/home-feed/route','../app/api/cron/fmv/route','../app/api/recognition/vision/route']){const route=await import(file);assert.equal((await route.GET()).status,410);assert.equal((await route.POST()).status,410)}
 const config=JSON.parse(readFileSync('vercel.json','utf8'));assert.ok(!config.crons.some((job:{path:string})=>job.path==='/api/cron/fmv'));
});
test('public product entry modules contain no active valuation or Market Pulse component/request',()=>{
 for(const file of ['app/hub.tsx','app/shared-directory.tsx','app/comic-picker.tsx','app/network.tsx','app/marketplace.tsx','app/listing-builder.tsx','app/scan-comic.tsx','architecture/platform-v2/ui/Homepage.tsx','architecture/platform-v2/ui/DirectoryCard.tsx']){
  const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/<(?:EstimatedValue|ListingEstimatedValue|CatalogFmv|MarketPulse|IssueValues|CombinedValue)\b|fetch\(['"]\/api\/(?:estimates|home-feed|recognition\/vision|activity)/,file);
 }
 const home=readFileSync('architecture/platform-v2/ui/Homepage.tsx','utf8');assert.match(home,/A Glimpse of the Directory/);assert.doesNotMatch(home,/Collector Picks|MCU \/ DC Film Keys|Top Ratio Variants|Value Collection/);assert.match(home,/<UpcomingPreview\/>/);
});
