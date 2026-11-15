/**
 * Sales & Value insights engine: pure, deterministic arithmetic over observations that the
 * data layer (lib/issue-insights.ts) gathered from permitted sources only. No network, no DB,
 * no LLM, no AI estimate snapshots. A guess is never presented as a sale: asks and bids never
 * set a value, and with no price observations the result is 'unavailable'. The only derived
 * number is a cautious grade-curve value for a requested grade with no sales of its own, built
 * from real sales of the same issue at other grades and always labelled with confidence 'low'.
 */
import {reportedSales,type ReportedSale} from './reported-sales';

export type ObservationKind='sale'|'ask'|'fmv'|'bid';
export type SourceId='licensed_fmv'|'licensed_sale'|'platform_sale'|'platform_reported_sale'|'cgc_reported'|'platform_ask'|'ebay_ask'|'platform_bid';
export type Observation={
 source:SourceId;
 /** Human-readable source name, e.g. "CGC-reported sales". */
 sourceName:string;
 kind:ObservationKind;
 amountUsd:number;
 /** ISO timestamp or YYYY-MM-DD (UTC). */
 date:string;
 dateEnd?:string;
 /** Exact numeric grade ('9.8'); null = raw/unknown grade. */
 grade:string|null;
 /** 'Raw' | 'Universal' | 'Signature Series' | 'Qualified' | 'Restored' | 'Conserved' | 'Label not specified'. */
 label:string;
 mode:'Raw'|'CGC';
 venue?:string;
 url?:string|null;
 /** Base source-quality weight (see SOURCE_WEIGHTS); time decay is applied separately. */
 weight:number;
 low?:number;
 high?:number;
 sampleSize?:number;
 windowDays?:number;
 /** Actual paid/hammer price reported by the venue or a verified payment. */
 confirmed?:boolean;
 /** Opaque seller/entity key used only to count independent sources; never returned. */
 entity?:string|null;
 note?:string;
 buyerPremium?:boolean;
 /** Historical licensed FMV point: used for trend only, not for the current value. */
 historyOnly?:boolean;
};

export const SOURCE_WEIGHTS:Readonly<Record<SourceId,number>>=Object.freeze({
 licensed_fmv:1,licensed_sale:1,platform_sale:0.85,cgc_reported:0.7,platform_reported_sale:0.35,
 ebay_ask:0.1,platform_ask:0.1,platform_bid:0.05,
});
export const INSIGHT_RULES=Object.freeze({
 saleHalfLifeDays:90,
 highConfidenceWindowDays:180,highConfidenceSales:5,highConfidenceIndependent:3,
 mediumConfidenceWindowDays:365,
 outlierMinimumPoints:4,logMadMultiplier:3*1.4826,zeroMadRatio:4,
 trendWindows:[90,180,365] as readonly number[],trendMinimumPoints:2,flatTrendPct:3,
 dealSignalMinimumPct:5,
 maxRecentSales:20,maxInsights:6,
 // Grade curve for derived values: log(value) is fitted linearly in grade from this issue's own
 // CGC sale buckets; with a single bucket the default slope (+25% value per grade point) is used.
 // The slope is clamped to [+5%, ×8] per grade point, and nothing is derived more than 1.5 grade points from an observed grade.
 gradeCurveDefaultSlope:Math.log(1.25),gradeCurveMinSlope:Math.log(1.05),gradeCurveMaxSlope:Math.log(8),gradeCurveMaxDistance:1.5,
});

const DAY=86_400_000;
export const CGC_GRADES=['10.0','9.9','9.8','9.6','9.4','9.2','9.0','8.5','8.0','7.5','7.0','6.5','6.0','5.5','5.0','4.5','4.0','3.5','3.0','2.5','2.0','1.8','1.5','1.0','0.5'];
const gradeSet=new Set(CGC_GRADES);

/** '9.8' / '9.80' / '10' / 'CGC 9.8' → canonical grade; anything else → null. */
export function normalizeGrade(raw:unknown):string|null{
 if(typeof raw==='number'&&Number.isFinite(raw))raw=String(raw);
 if(typeof raw!=='string')return null;
 const match=raw.match(/(?:^|[^0-9.])(10(?:\.0+)?|[0-9](?:\.[0-9]+)?)(?![0-9.])/);
 if(!match)return null;
 const value=Number(match[1]);if(!Number.isFinite(value))return null;
 const text=value.toFixed(1);return gradeSet.has(text)?text:null;
}
export function normalizeLabel(raw:unknown,mode:'Raw'|'CGC'):string{
 if(mode==='Raw')return 'Raw';
 const text=typeof raw==='string'?raw.toLowerCase():'';
 if(/signature|(^|\W)ss(\W|$)/.test(text))return 'Signature Series';
 if(/qualified/.test(text))return 'Qualified';
 if(/restor/.test(text))return 'Restored';
 if(/conserv/.test(text))return 'Conserved';
 if(/universal|blue label/.test(text))return 'Universal';
 return 'Label not specified';
}
/** Parse a free-text copy grade such as "CGC 9.8 Signature Series" or "Raw 8.0". */
export function parseCopyGrade(text:string):{mode:'Raw'|'CGC';grade:string|null;label:string}|null{
 if(/\b(cbcs|pgx|egs|hga)\b/i.test(text))return null;
 const mode:'Raw'|'CGC'=/\bcgc\b/i.test(text)?'CGC':'Raw';
 // Issue numbers ("#1", "300") must never be read as grades: CGC grades follow "CGC";
 // otherwise only an explicit decimal grade ("Raw 8.0", "VF 8.0") counts.
 const match=mode==='CGC'?text.match(/\bcgc\b[^0-9#]{0,14}(10(?:\.0)?|[0-9]\.[0-9])(?![0-9])/i):text.match(/(?:^|[^0-9.#])((?:10|[0-9])\.[0-9])(?![0-9])/);
 return {mode,grade:match?normalizeGrade(match[1]):null,label:normalizeLabel(text,mode)};
}

const labelGroup=(label:string)=>label==='Universal'||label==='Label not specified'?'standard':label;
export function bucketKey(o:Pick<Observation,'mode'|'grade'|'label'>){return [o.mode,o.grade??'Unspecified',o.mode==='Raw'?'Raw':labelGroup(o.label)].join('|')}
const isoTime=(date:string)=>{const time=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date)?date+'T00:00:00Z':date);return Number.isFinite(time)?time:NaN};
export const ageDays=(date:string,now:number)=>Math.max(0,(now-isoTime(date))/DAY);
/** Exponential time decay (half-life 90 days). */
export function decayedWeight(o:Observation,now:number,halfLife=INSIGHT_RULES.saleHalfLifeDays){
 const age=ageDays(o.date,now);return Number.isFinite(age)?o.weight*2**(-age/halfLife):0;
}

const median=(values:number[])=>{const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
/** Weighted quantile (inverse empirical CDF; averages the two sides on an exact boundary). */
export function weightedQuantile(points:{value:number;weight:number}[],fraction:number):number{
 const sorted=points.filter(p=>p.weight>0&&Number.isFinite(p.value)).sort((a,b)=>a.value-b.value);
 if(!sorted.length)return NaN;
 const total=sorted.reduce((s,p)=>s+p.weight,0),threshold=total*fraction;let acc=0;
 for(let i=0;i<sorted.length;i++){
  acc+=sorted[i].weight;
  if(Math.abs(acc-threshold)<=total*1e-9&&i+1<sorted.length)return (sorted[i].value+sorted[i+1].value)/2;
  if(acc>threshold)return sorted[i].value;
 }
 return sorted[sorted.length-1].value;
}
/** Robust trimming on log prices (median ± 3·1.4826·MAD); ratio fallback when MAD is zero. */
export function trimOutliers<T extends {amountUsd:number}>(rows:T[]):{kept:T[];removed:T[]}{
 if(rows.length<INSIGHT_RULES.outlierMinimumPoints)return {kept:[...rows],removed:[]};
 const logs=rows.map(r=>Math.log(r.amountUsd)),center=median(logs),mad=median(logs.map(v=>Math.abs(v-center)));
 const limit=mad>1e-12?INSIGHT_RULES.logMadMultiplier*mad:Math.log(INSIGHT_RULES.zeroMadRatio);
 const kept:T[]=[],removed:T[]=[];
 rows.forEach((r,i)=>(Math.abs(logs[i]-center)<=limit+1e-12?kept:removed).push(r));
 return {kept,removed};
}

export const roundMoney=(v:number)=>v>=100?Math.round(v):Math.round(v*100)/100;
export function formatUsd(v:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:v<100&&Math.round(v*100)%100?2:0,maximumFractionDigits:v<100?2:0}).format(v)}
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatDate(date:string){const d=new Date(isoTime(date));return months[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear()}
function formatDateRange(start:string,end?:string){
 if(!end||end===start)return formatDate(start);
 const a=new Date(isoTime(start)),b=new Date(isoTime(end));
 if(a.getUTCFullYear()===b.getUTCFullYear()&&a.getUTCMonth()===b.getUTCMonth())return months[a.getUTCMonth()]+' '+a.getUTCDate()+'–'+b.getUTCDate()+', '+a.getUTCFullYear();
 return formatDate(start)+' – '+formatDate(end);
}
const dayOnly=(date:string)=>new Date(isoTime(date)).toISOString().slice(0,10);
export function gradeText(mode:'Raw'|'CGC',grade:string|null,label?:string|null){
 if(mode==='Raw')return grade?'Raw '+grade:'Raw (ungraded)';
 const suffix=label&&label!=='Universal'&&label!=='Label not specified'?' '+label:'';
 return 'CGC '+(grade??'graded')+suffix;
}
const plural=(n:number,word:string,many=word+'s')=>n+' '+(n===1?word:many);

export type GradeBucket={
 key:string;mode:'Raw'|'CGC';grade:string;label:string;value:number;low:number;high:number;
 sales:number;salesConsidered:number;outliers:number;lastDate:string|null;source:string;totalWeight:number;
 confirmedSales:Observation[];points:Observation[];
};
/** Group value evidence (sales and current licensed FMV) by exact grade bucket. */
export function gradeBuckets(observations:Observation[],now:number):GradeBucket[]{
 const groups=new Map<string,Observation[]>();
 for(const o of observations){
  if(!['sale','fmv'].includes(o.kind)||o.historyOnly||!(o.amountUsd>0)||!Number.isFinite(isoTime(o.date)))continue;
  const key=bucketKey(o),list=groups.get(key)||[];list.push(o);groups.set(key,list);
 }
 const buckets:GradeBucket[]=[];
 for(const [key,rows] of groups){
  const sales=rows.filter(r=>r.kind==='sale'),{kept,removed}=trimOutliers(sales);
  const points=[...kept,...rows.filter(r=>r.kind!=='sale')];
  const weighted=points.map(p=>({o:p,w:decayedWeight(p,now)}));
  // Fall back to undecayed base weights when every point is very old (keeps the median defined).
  const usable=weighted.some(p=>p.w>1e-9)?weighted:points.map(p=>({o:p,w:p.weight}));
  const value=weightedQuantile(usable.map(p=>({value:p.o.amountUsd,weight:p.w})),0.5);
  if(!Number.isFinite(value))continue;
  let low=points.length>=3?weightedQuantile(usable.map(p=>({value:p.o.amountUsd,weight:p.w})),0.25):Math.min(...points.map(p=>p.amountUsd));
  let high=points.length>=3?weightedQuantile(usable.map(p=>({value:p.o.amountUsd,weight:p.w})),0.75):Math.max(...points.map(p=>p.amountUsd));
  const ranged=usable.filter(p=>p.o.low!==undefined&&p.o.high!==undefined);
  if(ranged.length){
   low=Math.min(low,weightedQuantile(ranged.map(p=>({value:p.o.low!,weight:p.w})),0.5));
   high=Math.max(high,weightedQuantile(ranged.map(p=>({value:p.o.high!,weight:p.w})),0.5));
  }
  low=Math.min(low,value);high=Math.max(high,value);
  const bySource=new Map<string,number>();for(const p of usable)bySource.set(p.o.sourceName,(bySource.get(p.o.sourceName)||0)+p.w);
  const source=[...bySource].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
  const labels=new Map<string,number>();for(const r of rows)labels.set(r.label,(labels.get(r.label)||0)+1);
  const label=[...labels].sort((a,b)=>b[1]-a[1]||(a[0]==='Label not specified'?-1:b[0]==='Label not specified'?1:a[0].localeCompare(b[0])))[0][0];
  const dates=points.map(p=>p.dateEnd||p.date).sort((a,b)=>isoTime(b)-isoTime(a));
  const saleDates=kept.map(p=>p.dateEnd||p.date).sort((a,b)=>isoTime(b)-isoTime(a));
  buckets.push({key,mode:rows[0].mode,grade:rows[0].grade??'Unspecified',label,value:roundMoney(value),low:roundMoney(low),high:roundMoney(high),
   sales:kept.length,salesConsidered:sales.length,outliers:removed.length,lastDate:saleDates[0]?dayOnly(saleDates[0]):dates[0]?dayOnly(dates[0]):null,source,
   totalWeight:usable.reduce((s,p)=>s+p.w,0),confirmedSales:kept.filter(k=>k.confirmed),points});
 }
 const gradeNumber=(g:string)=>g==='Unspecified'?-1:Number(g);
 return buckets.sort((a,b)=>(a.mode===b.mode?0:a.mode==='CGC'?-1:1)||gradeNumber(b.grade)-gradeNumber(a.grade)||a.label.localeCompare(b.label));
}

const standardLabel=(b:GradeBucket)=>b.mode==='Raw'||b.label==='Universal'||b.label==='Label not specified';
/** Requested grade first; otherwise the most-traded standard-label grade, newest sale breaking ties. */
export function pickHeadlineBucket(buckets:GradeBucket[],requestedGrade:string|null):GradeBucket|null{
 if(!buckets.length)return null;
 const rank=(list:GradeBucket[])=>[...list].sort((a,b)=>
  Number(standardLabel(b))-Number(standardLabel(a))||b.sales-a.sales||
  (b.lastDate?isoTime(b.lastDate):0)-(a.lastDate?isoTime(a.lastDate):0)||b.totalWeight-a.totalWeight||
  (a.mode===b.mode?0:a.mode==='CGC'?-1:1)||Number(b.grade)-Number(a.grade))[0];
 if(requestedGrade){const exact=buckets.filter(b=>b.grade===requestedGrade);if(exact.length)return rank(exact)}
 return rank(buckets);
}

export type Confidence='high'|'medium'|'low';
export function independentKey(o:Observation){return o.source+':'+(o.entity||o.venue||o.sourceName)}
export function confidenceFor(bucket:GradeBucket|null,now:number):Confidence|null{
 if(!bucket)return null;
 const within=(days:number)=>bucket.confirmedSales.filter(s=>ageDays(s.dateEnd||s.date,now)<=days);
 const recent=within(INSIGHT_RULES.highConfidenceWindowDays);
 if(recent.length>=INSIGHT_RULES.highConfidenceSales&&new Set(recent.map(independentKey)).size>=INSIGHT_RULES.highConfidenceIndependent)return 'high';
 const freshFmv=bucket.points.some(p=>p.kind==='fmv'&&(p.sampleSize??0)>=3&&ageDays(p.date,now)<=INSIGHT_RULES.highConfidenceWindowDays);
 if(recent.length>=2||freshFmv||within(INSIGHT_RULES.mediumConfidenceWindowDays).length>=3)return 'medium';
 return 'low';
}

export function headlineBasis(bucket:GradeBucket,now:number):string{
 const fmv=bucket.points.filter(p=>p.kind==='fmv');
 const sales=bucket.points.filter(p=>p.kind==='sale'),confirmed=sales.filter(s=>s.confirmed);
 const outlierNote=bucket.outliers?` (${plural(bucket.outliers,'outlier')} excluded)`:'';
 const salesPhrase=()=>{
  const word=confirmed.length===sales.length?'confirmed sale':'recorded sale';
  const dates=sales.map(s=>s.dateEnd||s.date).sort((a,b)=>isoTime(a)-isoTime(b));
  const oldest=ageDays(dates[0],now),reported=sales.every(s=>s.source==='cgc_reported');
  const lead=sales.length===1?(reported?'1 CGC-reported sale':'1 '+word):`Median of ${plural(sales.length,reported?'CGC-reported sale':word)}`;
  const span=sales.length===1?' on '+formatDateRange(sales[0].date,sales[0].dateEnd):oldest<=180?', last 180 days':oldest<=365?', last 12 months':`, ${formatDate(dates[0])} – ${formatDate(dates[dates.length-1])}`;
  return lead+outlierNote+span;
 };
 if(fmv.length&&!sales.length){const f=fmv[0];return `Licensed FMV from ${f.venue||f.sourceName}`+(f.sampleSize?`, ${plural(f.sampleSize,'sale')}`:'')+(f.windowDays?` over ${f.windowDays} days`:'')}
 if(sales.length&&fmv.length)return `Licensed FMV from ${fmv[0].venue||fmv[0].sourceName} blended with ${plural(sales.length,'recorded sale')}`;
 return salesPhrase();
}

export type DerivedValue={grade:string;value:number;low:number;high:number;basis:string;salesUsed:number;slopePerGrade:number};
/**
 * Cautious grade-curve value for a CGC grade with no observations of its own, from real sales of
 * the same issue at other standard-label CGC grades (≥2 sales). log(value) = a + b·grade, b fitted by least
 * squares when ≥2 distinct grades exist (clamped), else the default slope. The range widens with
 * distance from the nearest observed grade. Never used when the grade itself has data.
 */
export function deriveGradeValue(buckets:GradeBucket[],grade:string):DerivedValue|null{
 const target=Number(normalizeGrade(grade));if(!Number.isFinite(target))return null;
 const base=buckets.filter(b=>b.mode==='CGC'&&standardLabel(b)&&b.sales>0&&b.grade!=='Unspecified');
 if(!base.length||base.some(b=>Number(b.grade)===target))return null;
 const nearest=Math.min(...base.map(b=>Math.abs(Number(b.grade)-target)));
 if(nearest>INSIGHT_RULES.gradeCurveMaxDistance)return null;
 const xs=base.map(b=>Number(b.grade)),ys=base.map(b=>Math.log(b.value)),ws=base.map(b=>b.sales);
 const W=ws.reduce((s,w)=>s+w,0),mx=xs.reduce((s,x,i)=>s+x*ws[i],0)/W,my=ys.reduce((s,y,i)=>s+y*ws[i],0)/W;
 const sxx=xs.reduce((s,x,i)=>s+ws[i]*(x-mx)**2,0),sxy=xs.reduce((s,x,i)=>s+ws[i]*(x-mx)*(ys[i]-my),0);
 let slope=sxx>1e-9?sxy/sxx:INSIGHT_RULES.gradeCurveDefaultSlope;
 slope=Math.min(INSIGHT_RULES.gradeCurveMaxSlope,Math.max(INSIGHT_RULES.gradeCurveMinSlope,slope));
 const logValue=my+slope*(target-mx),value=Math.exp(logValue);
 // ±(15% + 10% per grade point from the nearest observed grade), in log space.
 const spread=Math.log(1.15)+Math.log(1.1)*nearest;
 const salesUsed=base.reduce((s,b)=>s+b.sales,0);
 if(salesUsed<2)return null; // one sale cannot anchor a curve
 // Three significant figures: a derived number must not look more precise than it is.
 const sig=(v:number)=>{const p=10**Math.max(0,Math.floor(Math.log10(v))-2);return Math.round(v/p)*p};
 return {grade:normalizeGrade(grade)!,value:sig(value),low:sig(Math.exp(logValue-spread)),high:sig(Math.exp(logValue+spread)),salesUsed,slopePerGrade:Math.round((Math.exp(slope)-1)*1000)/10,
  basis:`Derived from ${plural(salesUsed,'sale')} at other grades (grade-curve estimate, not a sale)`};
}

export type Trend={direction:'up'|'down'|'flat';changePct:number;windowDays:number};
/** Same-bucket comparison of recent vs prior window medians (sales + licensed FMV history). */
export function computeTrend(observations:Observation[],now:number):Trend|null{
 const points=observations.filter(o=>(o.kind==='sale'||o.kind==='fmv')&&o.amountUsd>0&&Number.isFinite(isoTime(o.date)));
 for(const windowDays of INSIGHT_RULES.trendWindows){
  const byBucket=new Map<string,{recent:number[];prior:number[]}>();
  for(const p of points){
   const age=ageDays(p.dateEnd||p.date,now);if(age>2*windowDays)continue;
   const key=bucketKey(p),entry=byBucket.get(key)||{recent:[],prior:[]};
   (age<=windowDays?entry.recent:entry.prior).push(p.amountUsd);byBucket.set(key,entry);
  }
  let weighted=0,weights=0;
  for(const {recent,prior} of byBucket.values()){
   if(recent.length<INSIGHT_RULES.trendMinimumPoints||prior.length<INSIGHT_RULES.trendMinimumPoints)continue;
   const change=median(recent)/median(prior)-1,w=Math.min(recent.length,prior.length);
   weighted+=change*w;weights+=w;
  }
  if(!weights)continue;
  const changePct=Math.round(weighted/weights*1000)/10;
  return {direction:Math.abs(changePct)<INSIGHT_RULES.flatTrendPct?'flat':changePct>0?'up':'down',changePct,windowDays};
 }
 return null;
}

/** Reported-sales adapter: CGC-reported individual sales keyed by curated issue ids. */
export function reportedSaleObservations(curatedId:number|null,rows:ReportedSale[]=reportedSales):Observation[]{
 if(curatedId===null)return [];
 return rows.filter(s=>s.issueId===curatedId&&s.amount>0).map(s=>({
  source:'cgc_reported' as const,sourceName:'CGC-reported sales',kind:'sale' as const,amountUsd:s.amount,date:s.date,...(s.dateEnd?{dateEnd:s.dateEnd}:{}),
  grade:normalizeGrade(s.grade),label:normalizeLabel(s.label,'CGC'),mode:'CGC' as const,venue:s.venue,url:s.source,weight:SOURCE_WEIGHTS.cgc_reported,
  confirmed:true,entity:'venue:'+s.venue.toLowerCase(),...(s.note?{note:s.note}:{}),...(s.buyerPremium?{buyerPremium:true}:{}),
 }));
}

/** Cover price display from GCD text such as "0.12 USD; 0.15 CAD". */
export function coverPriceDisplay(text:string|null|undefined):{display:string;usd:number|null}|null{
 const clean=(text||'').trim();if(!clean||/^none|^unknown|^\[/i.test(clean))return null;
 const usd=clean.match(/(\d+(?:\.\d+)?)\s*USD/i);
 if(usd){const v=Number(usd[1]);if(Number.isFinite(v)&&v>0)return {display:v<1?Math.round(v*100)+'¢':'$'+v.toFixed(2),usd:v}}
 return {display:clean.slice(0,60),usd:null};
}

export type AskSummary={count:number;low:number|null;median:number|null;high:number|null;source:string};
export type InsightsResponse={
 issueId:number;currency:'USD';status:'available'|'limited'|'unavailable';
 headline:{value:number;low:number;high:number;grade:string|null;label:string|null;basis:string}|null;
 confidence:Confidence|null;
 lastSale:{amount:number;date:string;grade:string|null;label:string|null;venue:string;sourceUrl:string|null}|null;
 byGrade:{grade:string;label:string;mode:'Raw'|'CGC';value:number;low:number;high:number;sales:number;lastDate:string|null;source:string}[];
 recentSales:{date:string;amount:number;grade:string|null;label:string|null;venue:string;source:string;sourceUrl:string|null;dateEnd?:string;confirmed?:boolean;note?:string}[];
 asks:AskSummary[];
 auctions:{active:number;highestBid:number|null;endsAt:string|null};
 demand:{wants:number|null;collections:number|null};
 trend:Trend|null;
 coverPrice:string|null;
 insights:string[];
 sources:{name:string;url:string|null;note:string}[];
 missingSources:{name:string;setup:string}[];
 updatedAt:string;
 // Optional extensions (additive to the contract).
 requestedGrade?:string|null;
 headlineMode?:'Raw'|'CGC'|null;
 /** true when the headline is the grade-curve value for a requested grade without its own data. */
 headlineDerived?:boolean;
 daysSinceLastSale?:number|null;
 dealSignal?:{askUsd:number;valueUsd:number;pct:number;grade:string;label:string;mode:'Raw'|'CGC';source:string}|null;
};
export type EngineInput={
 issueId:number;now:number;observations:Observation[];requestedGrade?:string|null;
 /** Ask summaries per source that was queried successfully (count 0 allowed). */
 askSources:string[];
 auctions:{active:number;highestBid:number|null;endsAt:string|null};
 demand:{wants:number|null;collections:number|null};
 coverPriceText?:string|null;
 sources?:{name:string;url:string|null;note:string}[];
 missingSources?:{name:string;setup:string}[];
};

function askSummaries(observations:Observation[],askSources:string[]):AskSummary[]{
 const names=[...new Set([...askSources,...observations.filter(o=>o.kind==='ask').map(o=>o.sourceName)])];
 return names.map(source=>{
  const values=observations.filter(o=>o.kind==='ask'&&o.sourceName===source&&o.amountUsd>0).map(o=>o.amountUsd).sort((a,b)=>a-b);
  return {count:values.length,low:values.length?roundMoney(values[0]):null,median:values.length?roundMoney(median(values)):null,high:values.length?roundMoney(values[values.length-1]):null,source};
 });
}

type RankedInsight={score:number;text:string};
export function computeInsights(input:EngineInput):InsightsResponse{
 const {now}=input,observations=input.observations.filter(o=>o.amountUsd>0&&Number.isFinite(o.amountUsd)&&Number.isFinite(isoTime(o.date)));
 const requestedGrade=input.requestedGrade?normalizeGrade(input.requestedGrade):null;
 const buckets=gradeBuckets(observations,now);
 const derived=requestedGrade&&!buckets.some(b=>b.grade===requestedGrade)?deriveGradeValue(buckets,requestedGrade):null;
 const headBucket=derived?null:pickHeadlineBucket(buckets,requestedGrade);
 const confidence:Confidence|null=derived?'low':confidenceFor(headBucket,now);
 const sales=observations.filter(o=>o.kind==='sale').sort((a,b)=>isoTime(b.dateEnd||b.date)-isoTime(a.dateEnd||a.date)||b.weight-a.weight||b.amountUsd-a.amountUsd);
 const last=sales[0]||null;
 const asks=askSummaries(observations,input.askSources);
 const trend=computeTrend(observations,now);
 const cover=coverPriceDisplay(input.coverPriceText);
 const headline=derived?{value:derived.value,low:derived.low,high:derived.high,grade:derived.grade,label:null,basis:derived.basis}
  :headBucket?{value:headBucket.value,low:headBucket.low,high:headBucket.high,grade:headBucket.grade==='Unspecified'?null:headBucket.grade,label:headBucket.label,basis:headlineBasis(headBucket,now)}:null;
 const status:InsightsResponse['status']=!headline?'unavailable':confidence==='low'?'limited':'available';
 const daysSinceLastSale=last?Math.floor(ageDays(last.dateEnd||last.date,now)):null;

 // Deal signal: the lowest ask whose exact grade bucket has a value (headline bucket preferred).
 let dealSignal:InsightsResponse['dealSignal']=null;
 const bucketByKey=new Map(buckets.map(b=>[b.key,b]));
 const askRows=observations.filter(o=>o.kind==='ask'&&o.grade).map(o=>({o,b:bucketByKey.get(bucketKey(o))})).filter(r=>r.b);
 if(askRows.length){
  const preferred=askRows.filter(r=>r.b===headBucket),pool=preferred.length?preferred:askRows;
  const best=pool.sort((x,y)=>x.o.amountUsd/x.b!.value-y.o.amountUsd/y.b!.value)[0];
  const pct=Math.round((best.o.amountUsd/best.b!.value-1)*1000)/10;
  dealSignal={askUsd:roundMoney(best.o.amountUsd),valueUsd:best.b!.value,pct,grade:best.b!.grade,label:best.b!.label,mode:best.b!.mode,source:best.o.sourceName};
 }

 const ranked:RankedInsight[]=[];
 const headGrade=derived?'CGC '+derived.grade:headBucket?gradeText(headBucket.mode,headBucket.grade==='Unspecified'?null:headBucket.grade,headBucket.label):'';
 if(last){
  const via=last.source==='cgc_reported'?` via ${last.venue}, reported by CGC`:last.source==='platform_sale'?' on ComicHuddle (verified payment)':last.source==='platform_reported_sale'?' on ComicHuddle (seller-reported, payment not verified)':last.source==='licensed_sale'?` via ${last.venue||'a licensed sales feed'}`:'';
  ranked.push({score:100,text:`Last sold for ${formatUsd(last.amountUsd)} (${gradeText(last.mode,last.grade,last.label)}) on ${formatDateRange(last.date,last.dateEnd)}${via}${last.buyerPremium?', including buyer’s premium':''}.`});
 }
 if(derived)ranked.push({score:95,text:`No recorded sales at CGC ${derived.grade} — estimated ${formatUsd(derived.low)}–${formatUsd(derived.high)} from ${plural(derived.salesUsed,'sale')} of this issue at other grades (not a sale).`});
 if(headBucket&&headline){
  ranked.push({score:90,text:`Typical ${headGrade} value is about ${formatUsd(headline.value)}`+(headline.high>headline.low?` (range ${formatUsd(headline.low)}–${formatUsd(headline.high)})`:'')+`, based on ${headline.basis.charAt(0).toLowerCase()+headline.basis.slice(1)}.`});
  if(requestedGrade&&headBucket.grade!==requestedGrade)ranked.push({score:92,text:`No sales or values recorded at grade ${requestedGrade}; showing ${headGrade} instead.`});
 }
 if(trend&&trend.direction!=='flat')ranked.push({score:85,text:`Values are ${trend.direction} ${Math.abs(trend.changePct)}% over the last ${trend.windowDays} days (same-grade comparison).`});
 else if(trend)ranked.push({score:50,text:`Values have been steady over the last ${trend.windowDays} days (within ${INSIGHT_RULES.flatTrendPct}%).`});
 if(dealSignal&&Math.abs(dealSignal.pct)>=INSIGHT_RULES.dealSignalMinimumPct){
  const g=gradeText(dealSignal.mode,dealSignal.grade==='Unspecified'?null:dealSignal.grade,dealSignal.label);
  ranked.push({score:dealSignal.pct<0?88:60,text:`Lowest ${dealSignal.source.includes('eBay')?'eBay asking price':'ask'} for ${g} is ${Math.abs(dealSignal.pct)}% ${dealSignal.pct<0?'below':'above'} the typical ${g} value.`});
 }
 const platform=asks.find(a=>a.source==='ComicHuddle listings'),listed=platform?.count??0,wants=input.demand.wants;
 if(wants!==null&&wants>=2&&wants>listed&&platform)ranked.push({score:80,text:listed?`Only ${plural(listed,'copy','copies')} listed while ${wants} collectors want it.`:`No copies listed on ComicHuddle while ${wants} collectors want it.`});
 else if(platform&&listed)ranked.push({score:55,text:`${plural(listed,'copy','copies')} listed on ComicHuddle${platform.low!==null?`, from ${formatUsd(platform.low)}`:''}.`});
 const ebay=asks.find(a=>a.source.includes('eBay'));
 if(ebay&&ebay.count)ranked.push({score:45,text:`${plural(ebay.count,'matching eBay listing')} asking ${ebay.low===ebay.high?formatUsd(ebay.low!):formatUsd(ebay.low!)+'–'+formatUsd(ebay.high!)} (asking prices, not sales).`});
 if(input.auctions.active)ranked.push({score:70,text:`${plural(input.auctions.active,'live auction')} on ComicHuddle`+(input.auctions.highestBid!==null?`, top bid ${formatUsd(input.auctions.highestBid)}`:'')+(input.auctions.endsAt?`, next ending ${formatDate(input.auctions.endsAt)}`:'')+'.'});
 const graded=buckets.filter(b=>b.sales>0);
 if(graded.length>=3){
  const sorted=[...graded].sort((a,b)=>a.value-b.value),lo=sorted[0],hi=sorted[sorted.length-1];
  ranked.push({score:65,text:`Recorded sales span ${formatUsd(lo.value)} (${gradeText(lo.mode,lo.grade==='Unspecified'?null:lo.grade,lo.label)}) to ${formatUsd(hi.value)} (${gradeText(hi.mode,hi.grade==='Unspecified'?null:hi.grade,hi.label)}) across ${graded.length} grades.`});
 }
 if(cover&&cover.usd!==null&&headline&&headBucket)ranked.push({score:40,text:`Cover price ${cover.display} → typical ${headGrade} value now ${formatUsd(headline.value)}.`});
 if(last&&daysSinceLastSale!==null&&daysSinceLastSale>365)ranked.push({score:75,text:`No recorded sale in over a year — treat values as dated.`});
 if(confidence==='low'&&headline&&headBucket)ranked.push({score:30,text:`Limited data: only ${plural(headBucket.sales,'recorded sale')} at this grade and few recent comparables — treat the value as a rough guide.`});
 if(!headline&&!last){
  const anyAsk=asks.some(a=>a.count>0);
  ranked.push({score:99,text:anyAsk?'No recorded sales or licensed values yet — asking prices are shown for reference only.':'No recorded sales, asking prices or licensed values for this issue yet.'});
 }
 const insights=ranked.sort((a,b)=>b.score-a.score).slice(0,INSIGHT_RULES.maxInsights).map(r=>r.text);

 return {
  issueId:input.issueId,currency:'USD',status,headline,confidence,
  lastSale:last?{amount:roundMoney(last.amountUsd),date:dayOnly(last.date),grade:last.grade,label:last.label,venue:last.venue||last.sourceName,sourceUrl:last.url??null}:null,
  byGrade:buckets.map(b=>({grade:b.grade,label:b.label,mode:b.mode,value:b.value,low:b.low,high:b.high,sales:b.sales,lastDate:b.lastDate,source:b.source})),
  recentSales:sales.slice(0,INSIGHT_RULES.maxRecentSales).map(s=>({date:dayOnly(s.date),amount:roundMoney(s.amountUsd),grade:s.grade,label:s.label,venue:s.venue||s.sourceName,source:s.sourceName,sourceUrl:s.url??null,
   ...(s.dateEnd?{dateEnd:dayOnly(s.dateEnd)}:{}),confirmed:!!s.confirmed,...(s.note?{note:s.note}:{})})),
  asks,auctions:input.auctions,demand:input.demand,trend,coverPrice:cover?.display??null,insights,
  sources:input.sources||[],missingSources:input.missingSources||[],updatedAt:new Date(now).toISOString(),
  requestedGrade,headlineMode:derived?'CGC':headBucket?.mode??null,headlineDerived:!!derived,daysSinceLastSale,dealSignal,
 };
}
