// Trophy definitions and fair-play rules (shared by server and client; no server imports).
// Trophies can't be bought, sold or transferred, and never give money or reward points.
export type TrophyGroup='collector'|'marketplace'|'community';
export type TierKey='bronze'|'silver'|'golden'|'single';
export const TIER_NAMES:Record<TierKey,string>={bronze:'Bronze Age',silver:'Silver Age',golden:'Golden Age',single:'Earned'};
export const TIER_ORDER:TierKey[]=['bronze','silver','golden'];
export type TrophyDef={id:string;name:string;group:TrophyGroup;rule:string;thresholds:[number,number,number]|null;unit:[string,string];
 /** Body for the unlock notification, e.g. "1,000 comics in your collection." */
 reason:(count:number)=>string;
 /** "1 more pickup for Local Hero" */
 nudge?:(left:number)=>string};
const n=(v:number)=>v.toLocaleString('en-US');
const plural=(v:number,[one,many]:[string,string])=>n(v)+' '+(v===1?one:many);
export const TROPHIES:readonly TrophyDef[]=[
 {id:'origin_story',name:'Origin Story',group:'collector',thresholds:null,unit:['step','steps'],rule:'Add a profile photo, a cover photo, a favorite character, a favorite comic and a grail.',reason:()=>'Your profile’s origin story is complete.'},
 {id:'first_appearance',name:'First Appearance',group:'collector',thresholds:null,unit:['comic','comics'],rule:'Add your first comic that’s linked to a Directory issue.',reason:()=>'Your first Directory comic is in your collection.'},
 {id:'longbox_legend',name:'Longbox Legend',group:'collector',thresholds:[100,500,1000],unit:['comic','comics'],rule:'Directory-linked comics in your collection.',reason:c=>plural(c,['comic','comics'])+' in your collection.',nudge:l=>`${plural(l,['more comic','more comics'])} for Longbox Legend`},
 {id:'key_master',name:'Key Master',group:'collector',thresholds:[5,25,50],unit:['key','keys'],rule:'Copies you own whose Directory issue is a key.',reason:c=>plural(c,['key issue','key issues'])+' in your collection.',nudge:l=>`${plural(l,['more key','more keys'])} for Key Master`},
 {id:'run_completist',name:'Run Completist',group:'collector',thresholds:[1,3,10],unit:['run','runs'],rule:'Runs of 12 or more issues with every issue owned.',reason:c=>plural(c,['complete run','complete runs'])+' of 12+ issues.',nudge:l=>`${plural(l,['more complete run','more complete runs'])} for Run Completist`},
 {id:'slab_squad',name:'Slab Squad',group:'collector',thresholds:[1,10,25],unit:['slab','slabs'],rule:'Graded copies with a cert number. Each cert counts once on the whole site, for the first owner who adds it.',reason:c=>plural(c,['slab','slabs'])+' with cert numbers.',nudge:l=>`${plural(l,['more slab','more slabs'])} for Slab Squad`},
 {id:'grail_hunter',name:'Grail Hunter',group:'collector',thresholds:[1,5,20],unit:['grail','grails'],rule:'Completed purchases of an issue that was on your wishlist before checkout.',reason:c=>plural(c,['wishlist comic','wishlist comics'])+' bought.',nudge:l=>`${plural(l,['more wishlist buy','more wishlist buys'])} for Grail Hunter`},
 {id:'first_sale',name:'First Sale',group:'marketplace',thresholds:null,unit:['sale','sales'],rule:'Your first completed sale.',reason:()=>'Your first sale is complete.'},
 {id:'trusted_seller',name:'Trusted Seller',group:'marketplace',thresholds:[10,50,250],unit:['sale','sales'],rule:'Completed sales while your rating stays 4.5★ or higher (95% positive if there are no star ratings).',reason:c=>plural(c,['completed sale','completed sales'])+' with a great rating.',nudge:l=>`${plural(l,['more sale','more sales'])} for Trusted Seller`},
 {id:'deal_maker',name:'Deal Maker',group:'marketplace',thresholds:[5,25,100],unit:['deal','deals'],rule:'Accepted offers, on either side, that became completed orders.',reason:c=>plural(c,['offer deal','offer deals'])+' completed.',nudge:l=>`${plural(l,['more offer deal','more offer deals'])} for Deal Maker`},
 {id:'local_hero',name:'Local Hero',group:'marketplace',thresholds:[3,15,50],unit:['pickup','pickups'],rule:'Local pickups confirmed with the pickup PIN.',reason:c=>plural(c,['pickup','pickups'])+' confirmed with the PIN.',nudge:l=>`${plural(l,['more pickup','more pickups'])} for Local Hero`},
 {id:'safepurchase_pro',name:'SafePurchase Pro',group:'marketplace',thresholds:[1,5,20],unit:['order','orders'],rule:'Completed SafePurchase orders, as buyer or seller.',reason:c=>plural(c,['SafePurchase order','SafePurchase orders'])+' completed.',nudge:l=>`${plural(l,['more SafePurchase order','more SafePurchase orders'])} for SafePurchase Pro`},
 {id:'five_star',name:'Five Star',group:'community',thresholds:[10,50,150],unit:['review','reviews'],rule:'Reviews from different collectors, averaging 4.8★ or higher (98% positive if there are no star ratings).',reason:c=>plural(c,['review','reviews'])+' from different collectors.',nudge:l=>`${plural(l,['more review','more reviews'])} for Five Star`},
 {id:'cover_contributor',name:'Cover Contributor',group:'community',thresholds:[1,25,100],unit:['cover','covers'],rule:'Your cover photos accepted into the Directory.',reason:c=>plural(c,['cover photo','cover photos'])+' accepted into the Directory.',nudge:l=>`${plural(l,['more cover','more covers'])} for Cover Contributor`},
 {id:'founding_huddler',name:'Founding Huddler',group:'community',thresholds:null,unit:['',''],rule:'Joined ComicHuddle during the founding period. It can never be earned after that.',reason:()=>'You joined during the founding period.'},
];
export const TROPHY_COUNT=TROPHIES.length;
export const trophyById=(id:string)=>TROPHIES.find(t=>t.id===id);
export const FAIR_PLAY_RULES=[
 'An order counts only when it’s completed (delivered or picked up with the PIN), past the review window (72 hours Standard, 48 hours SafePurchase), and not refunded, cancelled or disputed.',
 'Orders under $5 (item total, not counting shipping) don’t count.',
 'The same buyer and seller count at most once every 7 days.',
 'Each reviewer counts once toward Five Star, and only reviews tied to completed orders count.',
 'Comics deleted within 24 hours of being added don’t count toward collection trophies.',
 'If a count drops below a tier (a refund, fraud or a deletion), that tier quietly comes off your profile. Earn it again and it comes back.',
 'Trophies can’t be bought, sold or transferred, and never give money or reward points.',
];
/** Tiers reached for a count. */
export function tiersFor(def:TrophyDef,count:number):TierKey[]{
 if(!def.thresholds)return count>0?['single']:[];
 return TIER_ORDER.filter((_,i)=>count>=def.thresholds![i]);
}
/** Next tier and how far along (0..1), or null when maxed or single. */
export function nextTier(def:TrophyDef,count:number):{tier:TierKey;target:number;left:number;progress:number}|null{
 if(!def.thresholds)return null;
 const i=TIER_ORDER.findIndex((_,k)=>count<def.thresholds![k]);if(i<0)return null;
 const target=def.thresholds[i],floor=i?def.thresholds[i-1]:0;
 return {tier:TIER_ORDER[i],target,left:target-count,progress:Math.max(0,Math.min(1,(count-floor)/(target-floor)))};
}
export const tierRank=(tier:TierKey)=>tier==='golden'?3:tier==='silver'?2:tier==='bronze'?1:0;
export type TrophyStatus={id:string;name:string;group:TrophyGroup;rule:string;count:number;thresholds:[number,number,number]|null;earned:{tier:TierKey;earnedAt:string}[];next:ReturnType<typeof nextTier>};
