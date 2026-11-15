// Sales & Value insights engine: synthetic observations only (no DB, no network, no AI).
// Covers grade parsing/buckets, outlier trimming, time decay, trend, confidence, derived
// grade-curve values, insight wording, eBay asking-price filtering/caching and the no-AI rule.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
 computeInsights,computeTrend,confidenceFor,coverPriceDisplay,deriveGradeValue,gradeBuckets,normalizeGrade,parseCopyGrade,
 pickHeadlineBucket,reportedSaleObservations,trimOutliers,weightedQuantile,SOURCE_WEIGHTS,type EngineInput,type Observation,
} from '../lib/issue-insights-core';
import {clearEbayCache,ebayAskingPrices,ebayTitleMatches} from '../lib/ebay-browse';
import {coverLookupId} from '../lib/curated-cover-ids';
import {validIssueId} from '../lib/issue-insights';

const NOW=Date.parse('2026-11-14T12:00:00Z'),DAY=86_400_000;
const daysAgo=(d:number)=>new Date(NOW-d*DAY).toISOString();
let seq=0;
function sale(amount:number,age:number,over:Partial<Observation>={}):Observation{
 return {source:'licensed_sale',sourceName:'Licensed completed sales',kind:'sale',amountUsd:amount,date:daysAgo(age),grade:'9.8',label:'Universal',mode:'CGC',
  venue:'eBay',url:'https://example.test/s',weight:SOURCE_WEIGHTS.licensed_sale,confirmed:true,entity:'seller-'+(seq++),...over};
}
function ask(amount:number,over:Partial<Observation>={}):Observation{
 return {source:'platform_ask',sourceName:'ComicHuddle listings',kind:'ask',amountUsd:amount,date:daysAgo(0),grade:'9.8',label:'Universal',mode:'CGC',weight:SOURCE_WEIGHTS.platform_ask,...over};
}
const base=(observations:Observation[],over:Partial<EngineInput>={}):EngineInput=>({issueId:7,now:NOW,observations,askSources:['ComicHuddle listings'],
 auctions:{active:0,highestBid:null,endsAt:null},demand:{wants:0,collections:0},...over});

test('grades: canonical CGC grades only; issue numbers are never read as grades',()=>{
 assert.equal(normalizeGrade('9.8'),'9.8');assert.equal(normalizeGrade('10'),'10.0');assert.equal(normalizeGrade('9.80'),'9.8');
 assert.equal(normalizeGrade('9.7'),null);assert.equal(normalizeGrade('Unspecified'),null);assert.equal(normalizeGrade(null),null);
 assert.deepEqual(parseCopyGrade('Amazing Spider-Man #1 CGC 9.8'),{mode:'CGC',grade:'9.8',label:'Label not specified'});
 assert.deepEqual(parseCopyGrade('Raw 8.0'),{mode:'Raw',grade:'8.0',label:'Raw'});
 assert.equal(parseCopyGrade('X-Men 1 CGC SS 9.6 Signature Series')!.label,'Signature Series');
 assert.equal(parseCopyGrade('Amazing Spider-Man 300 raw')!.grade,null,'300 is an issue number');
 assert.equal(parseCopyGrade('Fantastic Four 1 CBCS 6.0'),null,'other graders are not mixed into CGC buckets');
});

test('empty input → unavailable with no fabricated value',()=>{
 const r=computeInsights(base([]));
 assert.equal(r.status,'unavailable');assert.equal(r.headline,null);assert.equal(r.confidence,null);assert.equal(r.lastSale,null);
 assert.deepEqual(r.byGrade,[]);assert.deepEqual(r.recentSales,[]);assert.equal(r.trend,null);
 assert.deepEqual(r.insights,['No recorded sales, asking prices or licensed values for this issue yet.']);
 assert.equal(r.currency,'USD');assert.equal(r.issueId,7);assert.equal(r.updatedAt,new Date(NOW).toISOString());
});

test('asks and bids alone never produce a value',()=>{
 const r=computeInsights(base([ask(100),ask(150),{...ask(5),kind:'bid',source:'platform_bid',sourceName:'ComicHuddle bids'}]));
 assert.equal(r.status,'unavailable');assert.equal(r.headline,null);
 assert.deepEqual(r.asks,[{count:2,low:100,median:125,high:150,source:'ComicHuddle listings'}]);
 assert.match(r.insights[0],/asking prices are shown for reference only/);
});

test('outliers: log-MAD trimming removes a wild price, keeps the cluster',()=>{
 const rows=[100,105,98,102,99,1000].map(a=>({amountUsd:a}));
 const {kept,removed}=trimOutliers(rows);
 assert.deepEqual(removed.map(r=>r.amountUsd),[1000]);assert.equal(kept.length,5);
 assert.equal(trimOutliers([{amountUsd:1},{amountUsd:1000},{amountUsd:5}]).removed.length,0,'fewer than 4 points are never trimmed');
 assert.deepEqual(trimOutliers([100,100,100,100,900].map(a=>({amountUsd:a}))).removed.map(r=>r.amountUsd),[900],'zero-MAD ratio fallback');
 const [bucket]=gradeBuckets([100,105,98,102,99,1000].map((a,i)=>sale(a,10+i)),NOW);
 assert.equal(bucket.outliers,1);assert.equal(bucket.sales,5);assert.ok(bucket.high<200);
});

test('time decay: recent sales dominate the weighted median',()=>{
 const [bucket]=gradeBuckets([sale(100,400),sale(100,420),sale(100,410),sale(200,5),sale(210,8)],NOW);
 assert.ok(bucket.value>=200,'two fresh sales outweigh three stale ones: '+bucket.value);
 assert.equal(weightedQuantile([{value:1,weight:1},{value:3,weight:1}],0.5),2,'exact-boundary median averages');
 assert.equal(weightedQuantile([{value:1,weight:1},{value:3,weight:5}],0.5),3);
});

test('grade buckets: exact grade + mode + label group; Universal and unspecified labels share a bucket',()=>{
 const buckets=gradeBuckets([sale(500,10),sale(520,10,{label:'Label not specified'}),sale(900,10,{label:'Signature Series'}),sale(120,10,{grade:'9.4'}),sale(40,10,{mode:'Raw',label:'Raw',grade:null})],NOW);
 assert.deepEqual(buckets.map(b=>[b.mode,b.grade,b.label,b.sales]),[
  ['CGC','9.8','Label not specified',2],['CGC','9.8','Signature Series',1],['CGC','9.4','Universal',1],['Raw','Unspecified','Raw',1]]);
 assert.equal(buckets[0].value,510);
 assert.equal(pickHeadlineBucket(buckets,null)!.key,buckets[0].key,'most-traded standard label wins');
 assert.equal(pickHeadlineBucket(buckets,'9.4')!.grade,'9.4','requested grade wins when present');
});

test('licensed FMV supplies value and range; history is trend-only',()=>{
 const fmv:Observation={source:'licensed_fmv',sourceName:'Licensed FMV',kind:'fmv',amountUsd:300,low:250,high:360,date:daysAgo(3),grade:'9.8',label:'Universal',mode:'CGC',venue:'Feed X',weight:3,sampleSize:8,windowDays:90};
 const old={...fmv,amountUsd:9999,date:daysAgo(30),historyOnly:true};
 const r=computeInsights(base([fmv,old]));
 assert.deepEqual(r.headline,{value:300,low:250,high:360,grade:'9.8',label:'Universal',basis:'Licensed FMV from Feed X, 8 sales over 90 days'});
 assert.equal(r.confidence,'medium');assert.equal(r.status,'available');assert.equal(r.lastSale,null,'FMV is not a sale');
});

test('trend: same-bucket recent vs prior window medians; needs ≥2 points each',()=>{
 const up=[sale(110,10),sale(114,20),sale(100,100),sale(100,120)];
 assert.deepEqual(computeTrend(up,NOW),{direction:'up',changePct:12,windowDays:90});
 assert.equal(computeTrend([sale(110,10),sale(100,100),sale(100,120)],NOW),null,'one recent point is not enough');
 assert.equal(computeTrend([sale(500,10,{grade:'9.8'}),sale(510,20,{grade:'9.8'}),sale(100,100,{grade:'6.0'}),sale(100,120,{grade:'6.0'})],NOW),null,'grades are never compared with each other');
 assert.equal(computeTrend([sale(101,10),sale(100,20),sale(100,100),sale(100,120)],NOW)!.direction,'flat');
 assert.deepEqual(computeTrend([sale(80,30),sale(80,60),sale(100,200),sale(100,300)],NOW),{direction:'down',changePct:-20,windowDays:180},'falls back to a wider window');
});

test('confidence: high needs ≥5 confirmed 180-day sales from ≥3 independent sellers',()=>{
 const five=[1,2,3,4,5].map(i=>sale(100+i,i*10));
 assert.equal(confidenceFor(gradeBuckets(five,NOW)[0],NOW),'high');
 const sameSeller=[1,2,3,4,5].map(i=>sale(100+i,i*10,{entity:'one',source:'licensed_sale'}));
 assert.equal(confidenceFor(gradeBuckets(sameSeller,NOW)[0],NOW),'medium','one seller cannot make high confidence');
 assert.equal(confidenceFor(gradeBuckets([sale(100,10),sale(100,20)],NOW)[0],NOW),'medium');
 assert.equal(confidenceFor(gradeBuckets([sale(100,10)],NOW)[0],NOW),'low');
 assert.equal(confidenceFor(gradeBuckets([sale(100,300),sale(100,320)],NOW)[0],NOW),'low');
 const unverified=[1,2,3,4,5].map(i=>sale(100,i*10,{source:'platform_reported_sale',confirmed:false}));
 assert.equal(confidenceFor(gradeBuckets(unverified,NOW)[0],NOW),'low','seller-reported sales are not confirmed');
 assert.equal(confidenceFor(null,NOW),null);
 const r=computeInsights(base(five));
 assert.equal(r.status,'available');assert.equal(r.headline!.basis,'Median of 5 confirmed sales, last 180 days');
});

test('insight wording: last sale, deal signal, trend, scarcity and auctions are factual',()=>{
 const reported:Observation={...sale(12000,30,{grade:'5.0',label:'Label not specified'}),source:'cgc_reported',sourceName:'CGC-reported sales',venue:'eBay',date:'2026-10-15'};
 const obs=[reported,sale(110,40),sale(114,50),sale(100,100),sale(100,120),ask(90)];
 const r=computeInsights(base(obs,{demand:{wants:14,collections:3},auctions:{active:2,highestBid:85,endsAt:'2026-11-20T18:00:00.000Z'},coverPriceText:'0.12 USD'}));
 assert.equal(r.insights[0],'Last sold for $12,000 (CGC 5.0) on Oct 15, 2026 via eBay, reported by CGC.');
 assert.ok(r.insights.includes('Values are up 12% over the last 90 days (same-grade comparison).'),r.insights.join('\n'));
 assert.ok(r.insights.some(t=>/^Lowest ask for CGC 9\.8 is \d+(\.\d)?% below the typical CGC 9\.8 value\.$/.test(t)),r.insights.join('\n'));
 assert.ok(r.insights.includes('Only 1 copy listed while 14 collectors want it.'));
 assert.ok(r.insights.length>=3&&r.insights.length<=6);
 assert.equal(r.dealSignal!.askUsd,90);assert.ok(r.dealSignal!.pct<0);
 assert.equal(r.coverPrice,'12¢');assert.deepEqual(r.auctions,{active:2,highestBid:85,endsAt:'2026-11-20T18:00:00.000Z'});
 assert.equal(r.recentSales[0].amount,12000);assert.equal(r.recentSales.length,5);
 assert.ok(r.recentSales.every((s,i,a)=>i===0||a[i-1].date>=s.date),'newest first');
 for(const text of r.insights)assert.doesNotMatch(text,/undefined|NaN|null/);
});

test('recent sales cap at 20, newest first',()=>{
 const r=computeInsights(base(Array.from({length:30},(_,i)=>sale(100+i,i+1))));
 assert.equal(r.recentSales.length,20);assert.equal(r.recentSales[0].date,daysAgo(1).slice(0,10));
});

test('derived grade-curve value: only near observed grades, labelled, low confidence',()=>{
 const obs=[sale(100,10,{grade:'9.0'}),sale(130,12,{grade:'9.2'}),sale(170,14,{grade:'9.4'})];
 const d=deriveGradeValue(gradeBuckets(obs,NOW),'9.6')!;
 assert.ok(d.value>170&&d.value<260,'continues the observed curve: '+d.value);
 assert.ok(d.low<d.value&&d.high>d.value);
 assert.equal(d.basis,'Derived from 3 sales at other grades (grade-curve estimate, not a sale)');
 assert.equal(deriveGradeValue(gradeBuckets(obs,NOW),'6.0'),null,'no extrapolation far from observed grades');
 assert.equal(deriveGradeValue(gradeBuckets(obs,NOW),'9.4'),null,'never replaces real data');
 assert.equal(deriveGradeValue(gradeBuckets([sale(100,10,{grade:'9.0'})],NOW),'9.2'),null,'one sale cannot anchor a curve');
 assert.equal(String(d.value).replace(/0+$/,'').length<=3,true,'rounded to 3 significant figures');
 const r=computeInsights(base(obs,{requestedGrade:'9.6'}));
 assert.equal(r.confidence,'low');assert.equal(r.status,'limited');assert.equal(r.headlineDerived,true);
 assert.equal(r.headline!.grade,'9.6');assert.match(r.headline!.basis,/^Derived from 3 sales at other grades/);
 assert.match(r.insights.join(' '),/No recorded sales at CGC 9\.6 — estimated .* \(not a sale\)\./);
 const far=computeInsights(base(obs,{requestedGrade:'4.0'}));
 assert.equal(far.headline!.grade,'9.0','newest sale wins the tie');assert.ok(far.insights.includes('No sales or values recorded at grade 4.0; showing CGC 9.0 instead.'));assert.equal(far.headlineDerived,false);
});

test('CGC-reported sales map from curated ids; curated and GCD ids resolve to the same book',()=>{
 const rows=reportedSaleObservations(32);
 assert.ok(rows.length>=4);assert.ok(rows.every(r=>r.source==='cgc_reported'&&r.kind==='sale'&&r.mode==='CGC'&&r.confirmed&&r.url?.startsWith('https://www.cgcgrading.com/')));
 assert.deepEqual(reportedSaleObservations(null),[]);
 assert.equal(coverLookupId(32),4000017568);
 const heritage=reportedSaleObservations(16).find(r=>r.dateEnd);
 assert.ok(heritage&&heritage.buyerPremium);
 const r=computeInsights(base(reportedSaleObservations(32)));
 assert.equal(r.lastSale!.venue,'ComicConnect');assert.equal(r.headline!.grade,'7.0');assert.equal(r.confidence,'low');
 assert.equal(validIssueId('32'),32);assert.equal(validIssueId('4000017568'),4000017568);
 for(const bad of ['-1','abc','1.5','99999999999','7000000000'])assert.equal(validIssueId(bad),null,bad);
});

test('cover price display',()=>{
 assert.deepEqual(coverPriceDisplay('0.12 USD'),{display:'12¢',usd:0.12});
 assert.deepEqual(coverPriceDisplay('1.50 USD; 2.00 CAD'),{display:'$1.50',usd:1.5});
 assert.equal(coverPriceDisplay(''),null);assert.equal(coverPriceDisplay('none'),null);
});

test('eBay Browse: disabled without keys; asking prices only, mismatches filtered, cached',async()=>{
 clearEbayCache();
 assert.deepEqual(await ebayAskingPrices({series:'Saga',number:'1',year:2012},{}),{status:'disabled'});
 const q={series:'The Amazing Spider-Man',number:'300',year:1988,variant:'Direct'};
 assert.ok(ebayTitleMatches('Amazing Spider-Man #300 CGC 9.8 1988 Venom',q));
 for(const bad of ['Amazing Spider-Man #300 Facsimile CGC 9.8','Amazing Spider-Man #301 CGC 9.8','Amazing Spider-Man #300 lot of 5','Amazing Spider-Man #300 Virgin Variant 2023','Amazing Spider-Man #300 2016 reprint','Spawn #300 CGC 9.8'])
  assert.equal(ebayTitleMatches(bad,q),false,bad);
 let calls=0;const seen:string[]=[];
 const fetcher=(async(url:string|URL,init?:RequestInit)=>{calls++;seen.push(String(url));
  if(String(url).includes('/oauth2/token')){assert.match(String(init?.body),/grant_type=client_credentials/);return Response.json({access_token:'t-123',expires_in:7200})}
  return Response.json({itemSummaries:[
   {itemId:'1',title:'Amazing Spider-Man #300 CGC 9.8 1988',price:{value:'1500.00',currency:'USD'},itemWebUrl:'https://www.ebay.com/itm/1'},
   {itemId:'2',title:'Amazing Spider-Man #300 Facsimile Edition CGC 9.8',price:{value:'60',currency:'USD'},itemWebUrl:'https://www.ebay.com/itm/2'},
   {itemId:'3',title:'Amazing Spider-Man 300 CBCS 9.8',price:{value:'1200',currency:'USD'}},
   {itemId:'4',title:'Amazing Spider-Man #300 raw',price:{value:'400',currency:'USD'},itemWebUrl:'https://evil.test/x'},
  ]})}) as typeof fetch;
 const env={EBAY_CLIENT_ID:'id',EBAY_CLIENT_SECRET:'secret'} as NodeJS.ProcessEnv;
 const first=await ebayAskingPrices(q,env,{fetcher,now:NOW});
 assert.equal(first.status,'ok');if(first.status!=='ok')return;
 assert.deepEqual(first.items.map(i=>[i.itemId,i.priceUsd,i.mode,i.grade,i.url]),[['1',1500,'CGC','9.8','https://www.ebay.com/itm/1'],['4',400,'Raw',null,null]]);
 assert.ok(seen[1].includes('category_ids=259104')&&seen[1].includes('FIXED_PRICE'));
 assert.ok(!JSON.stringify(first).includes('secret')&&!JSON.stringify(first).includes('t-123'),'no secrets in output');
 await ebayAskingPrices(q,env,{fetcher,now:NOW+5*3600_000});
 assert.equal(calls,2,'served from the ≥6h cache');
 const r=computeInsights(base(first.items.map(i=>({source:'ebay_ask' as const,sourceName:'eBay asking prices',kind:'ask' as const,amountUsd:i.priceUsd,date:daysAgo(0),grade:i.grade,label:i.label,mode:i.mode,weight:SOURCE_WEIGHTS.ebay_ask})),{askSources:['ComicHuddle listings','eBay asking prices']}));
 assert.equal(r.headline,null,'eBay asks never become a value');assert.equal(r.lastSale,null);
 assert.equal(r.asks.find(a=>a.source==='eBay asking prices')!.count,2);
 assert.ok(r.insights.some(t=>t.includes('(asking prices, not sales)')));
 clearEbayCache();
 const failing=(async()=>{throw Object.assign(Error('t'),{name:'TimeoutError'})}) as typeof fetch;
 assert.deepEqual(await ebayAskingPrices(q,env,{fetcher:failing,now:NOW}),{status:'error',reason:'ebay_timeout'});
});

test('no AI path: the insights engine never imports estimate/AI/model modules',()=>{
 for(const file of ['lib/issue-insights.ts','lib/issue-insights-core.ts','lib/ebay-browse.ts','app/api/issues/[id]/insights/route.ts']){
  const text=readFileSync(join(process.cwd(),file),'utf8');
  const imports=[...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  for(const spec of imports)assert.doesNotMatch(spec,/estimated-fmv|enrichment-ai|enrichment-jobs|enrichment-worker|structured-?ai|openai|anthropic|external-valuation/i,file+' imports '+spec);
  assert.doesNotMatch(text,/valuation_snapshots|valuation_targets|enqueueEnrichment|structuredAi|api\.openai\.com/,file+' must not read AI estimate snapshots');
 }
});
