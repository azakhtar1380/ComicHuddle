export const ESTIMATE_BADGE='Estimated FMV (AI-Powered)';
export const ESTIMATE_EXPLANATION='This price range is estimated by ComicHuddle using an OpenAI model and the evidence described here. It is not a verified sale price, professional appraisal, or guarantee of what the comic will sell for. Actual prices may differ.';
export type EstimateCondition={mode:'Raw'|'CGC';grade:string;label:string;printing:string;language?:string;signatureStatus?:string;restorationStatus?:string;certificationNumber?:string};
export type EstimateRequest={issueId:number;condition?:EstimateCondition;reference?:boolean};
export type EstimateTarget=EstimateRequest&{title:string;number:string;year:number;publisher:string;variant:string;language:string;conditionLabel:string};
export type EstimateStatus='awaiting_details'|'queued'|'generating'|'available'|'refreshing'|'insufficient_evidence'|'service_failure';
export type EstimateSnapshot={id:string|null;targetKey:string;target:EstimateTarget|null;status:EstimateStatus;lowCents:number|null;highCents:number|null;currency:'USD';evidenceKind:'none'|'baseline'|'comparable'|'sales';sampleCount:number;independentCount:number;calculatedAt:string|null;expiresAt:string|null;evidenceOldestAt:string|null;evidenceNewestAt:string|null;model:string|null;methodology:string;explanation:string;assumptions:string[];sources:{label:string;url?:string}[]};
export type EstimateComponent={id:string;title:string;quantity:number;request:EstimateRequest|null;snapshot:EstimateSnapshot};
export type CombinedEstimate={compositionVersion:string;components:EstimateComponent[];lowCents:number|null;highCents:number|null;pricedCopies:number;totalCopies:number;status:'complete'|'partial'|'unavailable';calculatedAt:string|null};
export const estimateRequestKey=(request:EstimateRequest)=>JSON.stringify([request.issueId,!!request.reference,request.condition?['mode','grade','label','printing','language','signatureStatus','restorationStatus'].map(key=>request.condition?.[key as keyof EstimateCondition]||''):null]);
export function unavailableEstimate(request:EstimateRequest|null,status:EstimateStatus='awaiting_details',explanation='An estimate is retrieved automatically once the exact edition and copy condition are recorded.'):EstimateSnapshot{
 return {id:null,targetKey:request?estimateRequestKey(request):'',target:null,status,lowCents:null,highCents:null,currency:'USD',evidenceKind:'none',sampleCount:0,independentCount:0,calculatedAt:null,expiresAt:null,evidenceOldestAt:null,evidenceNewestAt:null,model:null,methodology:'evidence-range-v1',explanation,assumptions:[],sources:[]};
}
/** Integer-cent arithmetic. Unpriced components are never assigned zero value. */
export function combineEstimates(components:EstimateComponent[],compositionVersion:string):CombinedEstimate{
 let low=0,high=0,priced=0,total=0;const dates:string[]=[];
 for(const item of components){
  if(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000)throw Error('Invalid copy quantity.');
  total+=item.quantity;const quote=item.snapshot;
  if(!['available','refreshing'].includes(quote.status)||!Number.isSafeInteger(quote.lowCents)||!Number.isSafeInteger(quote.highCents)||quote.lowCents!<=0||quote.highCents!<quote.lowCents!)continue;
  low+=quote.lowCents!*item.quantity;high+=quote.highCents!*item.quantity;priced+=item.quantity;if(quote.calculatedAt)dates.push(quote.calculatedAt);
 }
 if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||!Number.isSafeInteger(total))throw Error('Estimate total is outside supported limits.');
 return {compositionVersion,components,lowCents:priced?low:null,highCents:priced?high:null,pricedCopies:priced,totalCopies:total,status:priced===total&&total>0?'complete':priced?'partial':'unavailable',calculatedAt:dates.sort()[0]||null};
}
export const rangeLabel=(low:number,high:number)=>{const format=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:c%100?2:0}).format(c/100);return format(low)+'–'+format(high)};
export function isEstimateSnapshot(value:unknown):value is EstimateSnapshot{if(!value||typeof value!=='object')return false;const r=value as EstimateSnapshot;return (r.id===null||typeof r.id==='string')&&typeof r.targetKey==='string'&&['awaiting_details','queued','generating','available','refreshing','insufficient_evidence','service_failure'].includes(r.status)&&r.currency==='USD'&&typeof r.explanation==='string'&&Array.isArray(r.sources)&&r.sources.every(s=>typeof s.label==='string'&&(!s.url||/^https:\/\//.test(s.url)))&&Array.isArray(r.assumptions)&&r.assumptions.every(s=>typeof s==='string')&&Number.isSafeInteger(r.sampleCount)&&Number.isSafeInteger(r.independentCount)&&(r.lowCents===null&&r.highCents===null||Number.isSafeInteger(r.lowCents)&&r.lowCents!>0&&Number.isSafeInteger(r.highCents)&&r.highCents!>=r.lowCents!)}
