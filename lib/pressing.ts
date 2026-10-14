import type {ShowcaseBook} from './community';
export const careServices=[{id:'pressing',name:'Pressing',description:'Assess and address suitable bends, ripples and non-color-breaking defects.'},{id:'dry_cleaning',name:'Dry cleaning',description:'Carefully address appropriate surface dirt and soiling.'},{id:'assessment',name:'Pre-grading assessment',description:'Inspect the copy, discuss suitability and document condition.'},{id:'cgc',name:'CGC submission support',description:'Submission preparation or dealer submission, depending on the provider.'}] as const;
export type CareService=typeof careServices[number]['id'];
export type Provider={id:string;profileId:string;name:string;bio:string;location:string;locationZip?:string;locationCity?:string;locationState?:string;distanceMiles?:number|null;services:CareService[];prices:Partial<Record<CareService,number|null>>;specialties:string;experienceSince:number;turnaroundMin:number;turnaroundMax:number;mailIn:boolean;dropoff:boolean;accepting:boolean;visible:boolean;submissionMode:'none'|'prepare_only'|'dealer';dealerReference:string;website:string;logoId:string|null;portfolio:{before:string;after:string;caption:string}[];terms:string;createdAt:string;updatedAt:string;collector:{name:string;handle:string};rating:number|null;reviewCount:number;completedReviewCount:number;categoryRatings:{quality:number|null;communication:number|null;timeliness:number|null};rank:number|null;shippingAddress?:string;shippingNotes?:string};
export type CareReview={id:string;providerId:string;rating:number;quality:number;communication:number;timeliness:number;title:string;body:string;createdAt:string;updatedAt:string;author:{id:string;name:string;handle:string};completedRequest:boolean;mine:boolean};
export type CareBook=ShowcaseBook&{declaredValue:number};
export type CareJob={id:string;providerId:string;providerProfileId:string;requesterId:string;threadId:string;books:CareBook[];services:CareService[];notes:string;sendToCgc:boolean;status:string;method:'mail'|'dropoff';fee:number|null;returnShipping:number|null;cgcEstimate:number|null;quoteNotes:string;quoteDays:number|null;quoteRevision:number;termsSnapshot:string;shippingAddress:string;shippingNotes:string;returnAddress:string;incomingCarrier:string;incomingTracking:string;outgoingCarrier:string;outgoingTracking:string;submissionRef:string;createdAt:string;updatedAt:string;providerName:string;requesterName:string;providerHandle:string;isProvider:boolean};
export type CareEvent={id:string;status:string;note:string;photos:string[];createdAt:string;authorName:string};
export type CareData={providers:Provider[];mine:Provider|null;jobs:CareJob[];hasMore?:boolean};
export const emptyCare:CareData={providers:[],mine:null,jobs:[]};
export const careStatuses:Record<string,string>={requested:'Quote requested',quoted:'Quote ready',approved:'Quote accepted',in_transit:'On the way to provider',received:'Intake confirmed',pressing:'Pressing / cleaning',at_grading:'Submitted to CGC',returning:'On the way back',completed:'Receipt confirmed',cancelled:'Cancelled',declined:'Declined'};
export const careStages=['requested','approved','received','pressing','at_grading','returning','completed'];
export const cgcLinks={pressing:'https://www.cgccomics.com/pressing/',submit:'https://www.cgccomics.com/submit/how-to-submit/',dealers:'https://www.cgccomics.com/comics-dealer-locator/',terms:'https://www.cgccomics.com/legal/terms-and-conditions/',packing:'https://www.cgccomics.com/news/article/8272/mailing-submissions-to-cgc-headquarters/'};
export function careIntakeForViewer(job:{providerProfileId:string;status:string;shippingAddress:string;shippingNotes:string},viewerId:string){
 const visible=viewerId===job.providerProfileId||!['requested','quoted','declined','cancelled'].includes(job.status);
 return {shippingAddress:visible?job.shippingAddress:'',shippingNotes:visible?job.shippingNotes:''};
}
export function rankProviders(rows:Provider[]):Provider[]{
 const ranked=rows.filter(p=>p.reviewCount>=3&&p.rating!==null&&Number.isFinite(p.rating)&&p.rating>=1&&p.rating<=5).sort((a,b)=>(b.rating!-a.rating!)||b.reviewCount-a.reviewCount||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const positions=new Map(ranked.map((p,i)=>[p.id,i+1]));return rows.map(p=>({...p,rank:positions.get(p.id)??null}));
}
export const workshopStates=[
 ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['PR','Puerto Rico'],['GU','Guam'],['VI','U.S. Virgin Islands'],['AS','American Samoa'],['MP','Northern Mariana Islands']
] as const;
const normalizeArea=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const stateFor=(value:string)=>workshopStates.find(([code,name])=>normalizeArea(value)===normalizeArea(code)||normalizeArea(value)===normalizeArea(name));
export function workshopLocation(location:string):{city:string;state:string;stateName:string}{
 const parts=location.trim().replace(/\s+/g,' ').split(/\s*[,·|]\s*/).filter(value=>value&&!['usa','us','u s','u s a','united states','united states of america'].includes(normalizeArea(value)));
 let city=parts[0]||'',region=parts[1]||'';
 if(parts.length===1){
  const suffix=[...workshopStates].sort((a,b)=>b[1].length-a[1].length).find(([code,name])=>normalizeArea(city).endsWith(' '+normalizeArea(code))||normalizeArea(city).endsWith(' '+normalizeArea(name)));
  if(suffix){const token=normalizeArea(city).endsWith(' '+normalizeArea(suffix[1]))?suffix[1]:suffix[0];if(city.toLowerCase().endsWith(' '+token.toLowerCase())){region=suffix[0];city=city.slice(0,-token.length).trim()}}
  else if(/^[A-Za-z]{2}$/.test(city)&&stateFor(city)){region=city;city=''}
 }
 const state=stateFor(region);
 return {city,state:state?.[0]||region,stateName:state?.[1]||region};
}
export type WorkshopFilters={query?:string;city?:string;state?:string;service?:CareService|'all';method?:'all'|'mail'|'dropoff';accepting?:boolean};
export function filterWorkshopProviders(rows:Provider[],filters:WorkshopFilters):Provider[]{
 const terms=normalizeArea(filters.query||'').split(' ').filter(Boolean);
 return rows.filter(provider=>{
  const area=workshopLocation(provider.location),haystack=normalizeArea([provider.name,provider.collector.name,provider.collector.handle,provider.specialties,provider.location].join(' '));
  return terms.every(term=>haystack.includes(term))&&(!filters.city||normalizeArea(area.city)===normalizeArea(filters.city))&&(!filters.state||normalizeArea(area.state)===normalizeArea(stateFor(filters.state)?.[0]||filters.state))&&(!filters.service||filters.service==='all'||provider.services.includes(filters.service))&&(!filters.method||filters.method==='all'||(filters.method==='mail'?provider.mailIn:provider.dropoff))&&(!filters.accepting||provider.accepting);
 });
}
export function workshopAreaOptions(rows:Provider[],state=''):{states:{value:string;label:string}[];cities:{value:string;label:string}[]}{
 const states=new Map<string,string>(),cities=new Map<string,string>();
 for(const provider of rows){const area=workshopLocation(provider.location);if(area.state)states.set(area.state,area.stateName);if(area.city&&(!state||normalizeArea(area.state)===normalizeArea(state)))cities.set(normalizeArea(area.city),area.city)}
 const sorted=(map:Map<string,string>)=>[...map].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'en',{sensitivity:'base'}));
 return {states:sorted(states),cities:sorted(cities)};
}
export function canCareTransition(status:string,next:string,isProvider:boolean,sendToCgc:boolean){
 const allowed:Record<string,string[]>=isProvider?{requested:['declined'],quoted:['declined'],approved:['received'],in_transit:['received'],received:['pressing','returning'],pressing:sendToCgc?['at_grading','returning']:['returning'],at_grading:['returning']}:{requested:['cancelled'],quoted:['cancelled'],approved:['in_transit','cancelled'],returning:['completed']};
 return !!allowed[status]?.includes(next);
}
