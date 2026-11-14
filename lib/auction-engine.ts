// Pure eBay-style proxy bidding. All amounts are integer cents.
export const auctionDurationDays=[1,3,5,7,10] as const;
const bands:[number,number][]=[[100,5],[500,25],[2500,50],[10000,100],[25000,250],[50000,500],[100000,1000],[250000,2500],[500000,5000],[Infinity,10000]];
/** Minimum raise at a current price, by eBay-like price band. */
export function bidIncrement(currentCents:number){for(const [below,step] of bands)if(currentCents<below)return step;return 10000}
export type ProxyLeader={bidderId:string;maxCents:number;bidId:string};
export type ProxyState={openingCents:number;reserveCents:number|null;leader:ProxyLeader|null;currentCents:number|null};
export type ProxyBid={bidderId:string;maxCents:number;bidId:string};
export type ProxyResult={accepted:true;state:ProxyState;outcome:'leading'|'outbid'|'raised_max';displayCents:number}|{accepted:false;error:'below_minimum'|'not_above_own_max'};
/** The lowest maximum a new (non-leading) bidder may submit. */
export function minimumBid(state:ProxyState){return state.leader&&state.currentCents!==null?state.currentCents+bidIncrement(state.currentCents):state.openingCents}
function withReserve(state:ProxyState):ProxyState{
 // Meeting the reserve moves the visible price up to the reserve, capped by the leader's maximum.
 if(state.leader&&state.reserveCents!==null&&state.currentCents!==null&&state.leader.maxCents>=state.reserveCents&&state.currentCents<state.reserveCents)return {...state,currentCents:state.reserveCents};
 return state;
}
export function reserveMet(state:Pick<ProxyState,'reserveCents'|'leader'>){return state.reserveCents===null||!!state.leader&&state.leader.maxCents>=state.reserveCents}
/**
 * Applies one maximum bid. The visible price is the second-highest maximum plus one increment,
 * capped at the leader's maximum. Equal maximums keep the earlier bidder in the lead.
 */
export function applyProxyBid(state:ProxyState,bid:ProxyBid):ProxyResult{
 const leader=state.leader;
 if(!leader){
  if(bid.maxCents<state.openingCents)return {accepted:false,error:'below_minimum'};
  const next=withReserve({...state,leader:{...bid},currentCents:state.openingCents});
  return {accepted:true,state:next,outcome:'leading',displayCents:next.currentCents!};
 }
 if(leader.bidderId===bid.bidderId){
  if(bid.maxCents<=leader.maxCents)return {accepted:false,error:'not_above_own_max'};
  const next=withReserve({...state,leader:{...leader,maxCents:bid.maxCents,bidId:bid.bidId}});
  return {accepted:true,state:next,outcome:'raised_max',displayCents:next.currentCents!};
 }
 if(bid.maxCents<minimumBid(state))return {accepted:false,error:'below_minimum'};
 if(bid.maxCents>leader.maxCents){
  const next=withReserve({...state,leader:{...bid},currentCents:Math.min(bid.maxCents,leader.maxCents+bidIncrement(leader.maxCents))});
  return {accepted:true,state:next,outcome:'leading',displayCents:next.currentCents!};
 }
 const next=withReserve({...state,currentCents:Math.min(leader.maxCents,bid.maxCents+bidIncrement(bid.maxCents))});
 return {accepted:true,state:next,outcome:'outbid',displayCents:bid.maxCents};
}
export type AuctionResolution={result:'no_bids'|'reserve_not_met'|'awaiting_payment';winnerId:string|null;winningCents:number|null};
export function resolveAuction(state:ProxyState):AuctionResolution{
 if(!state.leader||state.currentCents===null)return {result:'no_bids',winnerId:null,winningCents:null};
 if(!reserveMet(state))return {result:'reserve_not_met',winnerId:null,winningCents:null};
 return {result:'awaiting_payment',winnerId:state.leader.bidderId,winningCents:state.currentCents};
}
/** "collector" → "c*******r"; short handles still hide every middle character. */
export function maskHandle(handle:string){const value=(handle||'').trim();if(value.length<=1)return '*';if(value.length===2)return value[0]+'*';return value[0]+'*'.repeat(Math.min(6,value.length-2))+value[value.length-1]}
export const AUCTION_PAYMENT_WINDOW_HOURS=48;
