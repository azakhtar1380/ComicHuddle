// ComicHuddle links inside private messages (shared by the server previews and the client renderer).
// Only links to this site are recognised; previews are resolved server-side with normal visibility rules.

export type LinkPreview=
 {kind:'listing';href:string;id:string;title:string;grade:string;price:number;status:string;saleType:string;currentBid:number|null;photo:string|null}
|{kind:'provider';href:string;id:string;name:string;location:string;photo:string|null}
|{kind:'issue';href:string;id:number;title:string;number:string;publisher:string;year:number|null;cover:string|null};

export type MessageLink={kind:'listing'|'provider'|'issue';id:string;text:string};
export const previewKey=(link:{kind:string;id:string|number})=>link.kind+':'+link.id;

const linkPattern=/(?:https?:\/\/([a-z0-9.:-]+))?\/\?([^\s<>"']+)/gi;

/** ComicHuddle listing / studio / comic links in a message. `host` is this site's host (links elsewhere are ignored). */
export function messageLinks(body:string,host:string):MessageLink[]{
 const found:MessageLink[]=[];
 for(const match of body.matchAll(linkPattern)){
  if(match[1]&&match[1].toLowerCase()!==host.toLowerCase()&&!/(^|\.)comichuddle\.com$/i.test(match[1]))continue;
  const q=new URLSearchParams(match[2].replace(/[).,!?]+$/,'')),section=q.get('section');
  const listing=q.get('listing'),provider=q.get('provider'),issue=q.get('issue');
  if(listing&&(!section||section==='Marketplace'))found.push({kind:'listing',id:listing.slice(0,100),text:match[0]});
  else if(provider&&section==='Pressing')found.push({kind:'provider',id:provider.slice(0,100),text:match[0]});
  else if(issue&&/^\d{1,12}$/.test(issue))found.push({kind:'issue',id:issue,text:match[0]});
 }
 return found;
}

export const listingLink=(origin:string,id:string)=>origin+'/?section=Marketplace&listing='+encodeURIComponent(id);
export const providerLink=(origin:string,id:string)=>origin+'/?section=Pressing&provider='+encodeURIComponent(id);
