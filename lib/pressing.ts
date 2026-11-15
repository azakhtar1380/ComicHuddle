import type {ShowcaseBook} from './community';
export const careServices=[{id:'pressing',name:'Pressing',description:'Assess and address suitable bends, ripples and non-color-breaking defects.'},{id:'dry_cleaning',name:'Dry cleaning',description:'Carefully address appropriate surface dirt and soiling.'},{id:'assessment',name:'Pre-grading assessment',description:'Inspect the copy, discuss suitability and document condition.'},{id:'cgc',name:'CGC submission support',description:'Submission preparation or dealer submission, depending on the provider.'},{id:'restoration',name:'Restoration',description:'Permanent repair such as tear seals, piece fills or color touch. Always disclosed; CGC grades restored books on its Restored label.'}] as const;
export type CareService=typeof careServices[number]['id'];
export type Provider={id:string;profileId:string;name:string;bio:string;location:string;locationZip?:string;locationCity?:string;locationState?:string;distanceMiles?:number|null;services:CareService[];prices:Partial<Record<CareService,number|null>>;specialties:string;experienceSince:number;turnaroundMin:number;turnaroundMax:number;mailIn:boolean;dropoff:boolean;accepting:boolean;visible:boolean;submissionMode:'none'|'prepare_only'|'dealer';dealerReference:string;website:string;logoId:string|null;portfolio:{before:string;after:string;caption:string}[];terms:string;createdAt:string;updatedAt:string;collector:{name:string;handle:string};rating:number|null;reviewCount:number;completedReviewCount:number;categoryRatings:{quality:number|null;communication:number|null;timeliness:number|null};rank:number|null;shippingAddress?:string;shippingNotes?:string};
export type CareReview={id:string;providerId:string;rating:number;quality:number;communication:number;timeliness:number;title:string;body:string;createdAt:string;updatedAt:string;author:{id:string;name:string;handle:string};verified?:boolean;completedRequest:boolean;mine:boolean};
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

/* ---- Workshop discovery helpers (client + checks). Educational copy only: no provider data is invented here. ---- */
export type CareServiceGuide={id:CareService;short:string;what:string;why:string;tell:string[]};
export const careServiceGuide:CareServiceGuide[]=[
 {id:'pressing',short:'Flattens non-color-breaking bends, waves and ripples.',what:'Controlled heat, humidity and pressure relax the paper so non-color-breaking bends, spine rolls and waviness lie flatter.',why:'Small dents and waves can cost a book grade points. Many collectors press before sending a key issue for grading.',tell:['Which defects you want addressed (bends, waves, spine roll)','Any color-breaking creases, tears or tape','Signatures, stamps or anything else to protect']},
 {id:'dry_cleaning',short:'Lifts surface dirt, dust shadows and light soiling.',what:'Dry methods such as specialist erasers and sponges lift surface dirt and dust shadows without water or solvents.',why:'Surface grime makes covers look dull and can read as wear. It is often paired with pressing.',tell:['Where the dirt or shadowing is','Glossy or matte cover stock, if you know it','Pencil marks or writing you want left alone']},
 {id:'assessment',short:'An expert look before you spend on grading.',what:'The studio inspects the copy, notes defects and tells you whether pressing or cleaning is likely to help.',why:'Not every book benefits. An assessment helps you decide before paying for care, shipping and grading.',tell:['Your goal: keep, sell or grade','The grade you are hoping for, if any','Front, back and spine photos (send them in Messages)']},
 {id:'restoration',short:'Permanent repairs: tear seals, piece fills, color touch.',what:'A restorer repairs physical damage with added material, such as sealing tears, filling missing pieces, reinforcing spines or touching up color. It is different from pressing and cleaning because it adds or changes material.',why:'It can make a damaged book whole and much nicer to display. It is permanent and must be disclosed when you sell: CGC detects most restoration and grades the book on its purple Restored label, which usually sells for less than an unrestored copy.',tell:['Exactly what is damaged (tears, missing pieces, loose staples, color loss)','Whether you want the book to be graded or sold later','Photos of each problem area (send them in Messages)']},
 {id:'cgc',short:'Help preparing or submitting books to CGC.',what:'Depending on the studio, they prep books for you to send yourself, or submit them to CGC through their dealer account.',why:'Submissions have paperwork, tiers and packing rules. A studio can save time, especially right after pressing.',tell:['Whether you want them to submit or only prep','Your preferred CGC tier and any label notes','Declared values you are comfortable with']},
];
export const careGuideFor=(id:string)=>careServiceGuide.find(g=>g.id===id);
export type WorkshopSort='recommended'|'rating'|'distance'|'newest'|'name';
export function sortWorkshopProviders(rows:Provider[],sort:WorkshopSort):Provider[]{
 const byRating=(a:Provider,b:Provider)=>((b.rating??-1)-(a.rating??-1))||b.reviewCount-a.reviewCount;
 const byName=(a:Provider,b:Provider)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'});
 const byDistance=(a:Provider,b:Provider)=>(a.distanceMiles??Infinity)-(b.distanceMiles??Infinity)||0;
 const newest=(a:Provider,b:Provider)=>b.createdAt.localeCompare(a.createdAt);
 const order:Record<WorkshopSort,(a:Provider,b:Provider)=>number>={
  recommended:(a,b)=>Number(b.accepting)-Number(a.accepting)||byDistance(a,b)||byRating(a,b)||byName(a,b),
  rating:(a,b)=>byRating(a,b)||byName(a,b),
  distance:(a,b)=>byDistance(a,b)||byRating(a,b)||byName(a,b),
  newest:(a,b)=>newest(a,b)||byName(a,b),
  name:byName};
 return [...rows].sort(order[sort]);
}
/** Real counts of listed studios per service, most offered first. */
export function serviceCounts(rows:Provider[]){return careServices.map(s=>({id:s.id as CareService,name:s.name,count:rows.filter(p=>p.services.includes(s.id)).length})).sort((a,b)=>b.count-a.count)}
/** Studios with enough verified reviews to be ranked (see rankProviders), best first. */
export const topRatedProviders=(rows:Provider[],limit=3)=>rows.filter(p=>p.rank!==null).sort((a,b)=>(a.rank??0)-(b.rank??0)).slice(0,limit);
export function recentlyAddedProviders(rows:Provider[],now=Date.now(),days=60,limit=3){const since=new Date(now-days*864e5).toISOString();return rows.filter(p=>p.createdAt>=since).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit)}
/** What a studio has (and hasn't) filled in, for the owner's "improve your listing" checklist. */
export function studioCompleteness(p:Provider){
 const items=[
  {id:'logo',label:'Add a logo',done:!!p.logoId},
  {id:'portfolio',label:'Add before-and-after photos',done:p.portfolio.length>0},
  {id:'prices',label:'List a starting price',done:p.services.some(s=>typeof p.prices[s]==='number')},
  {id:'specialties',label:'Add your specialties',done:!!p.specialties.trim()},
  {id:'website',label:'Add your website',done:!!p.website},
  {id:'zip',label:'Add a ZIP code so nearby collectors find you',done:!!p.locationZip||!!p.locationCity}];
 return {items,done:items.filter(i=>i.done).length,total:items.length};
}
export function ratingBreakdown(reviews:{rating:number}[]){return {counts:[5,4,3,2,1].map(star=>({star,count:reviews.filter(r=>Math.round(r.rating)===star).length})),total:reviews.length}}
export type ReviewSort='newest'|'highest'|'lowest';
export function sortReviews<T extends {rating:number;updatedAt:string}>(rows:T[],sort:ReviewSort):T[]{
 return [...rows].sort((a,b)=>sort==='highest'?b.rating-a.rating||b.updatedAt.localeCompare(a.updatedAt):sort==='lowest'?a.rating-b.rating||b.updatedAt.localeCompare(a.updatedAt):b.updatedAt.localeCompare(a.updatedAt));
}
export const careClosed=(status:string)=>['completed','cancelled','declined'].includes(status);
/** Plain-language "what happens next" for a request, from the viewer's side. */
export function careNextStep(job:{status:string;isProvider:boolean;method:'mail'|'dropoff';sendToCgc:boolean}):string{
 const p=job.isProvider;
 switch(job.status){
  case 'requested':return p?'Send a quote':'Waiting for the studio’s quote';
  case 'quoted':return p?'Waiting for the collector to accept':'Review and accept the quote';
  case 'approved':return p?(job.method==='mail'?'Waiting for the books to ship':'Confirm when the books are dropped off'):(job.method==='mail'?'Ship your books and add tracking':'Drop off your books');
  case 'in_transit':return p?'Confirm the books arrived':'Books on the way to the studio';
  case 'received':return p?'Start the care work':'The studio has your books';
  case 'pressing':return p?(job.sendToCgc?'Submit to CGC or return the books':'Return the books'):'Care work in progress';
  case 'at_grading':return p?'Return the books once graded':'At CGC for grading';
  case 'returning':return p?'Waiting for the collector to confirm':'Confirm when your books are back';
  case 'completed':return 'Finished';
  case 'cancelled':return 'Cancelled';
  case 'declined':return 'Declined by the studio';
  default:return '';
 }
}
export function careProgress(status:string,sendToCgc:boolean){
 const stages=careStages.filter(s=>s!=='at_grading'||sendToCgc),alias:Record<string,string>={quoted:'requested',in_transit:'approved'},i=stages.indexOf(alias[status]||status);
 return {step:i<0?0:i+1,total:stages.length};
}
