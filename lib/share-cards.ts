// Profile share cards as SVG (1080×1920 story size): "slab" (a generic clear graded-slab look, no grading
// company branding) and "trading card". The same markup is shown inline as the preview and drawn to a canvas
// for the PNG. Images must be data: URLs for the PNG export. No publisher art: the window shows the member's
// own cover photo or the world pattern.
export type ShareCardStyle='slab'|'trading';
export type ShareCardData={name:string;handle:string;since:number;comics:number;keys:number;verified:'person'|'business'|null;
 favoriteCharacter:string|null;grail:string|null;avatar:string|null;cover:string|null;huddles:string;sky:[string,string];accent:string;trophy?:{name:string;tier:string}|null};
const esc=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;
const HEAD="font-family=\"'Barlow Condensed','Arial Narrow',Impact,sans-serif\" font-weight=\"800\"",BODY="font-family=\"'DM Sans',Arial,sans-serif\"";
const rosette=(x:number,y:number,s:number)=>`<g transform="translate(${x} ${y}) scale(${s/24})" data-role="verified"><path fill="#1d5fc4" d="M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7.6 12.3l3 3 5.8-6.3"/></g>`;
/** Avatar (or the person outline) in a circle with Mr. Huddles at its bottom-right, same proportions as the profile (124px photo, 84px Huddles). */
function avatarBlock(d:ShareCardData,cx:number,cy:number,r:number){
 const size=r*2,hud=size*84/124,hudW=hud*359/512,hx=cx+r-hudW*.32,hy=cy+r-hud+size*6/124;
 const photo=d.avatar?`<image href="${esc(d.avatar)}" x="${cx-r}" y="${cy-r}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" data-role="avatar"/>`
  :`<g data-role="avatar"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#dotsLight)"/><circle cx="${cx}" cy="${cy-r*.18}" r="${r*.3}" fill="none" stroke="#20201f" stroke-width="${r*.07}"/><path d="M${cx-r*.55} ${cy+r*.62}c${r*.06}-${r*.36} ${r*.3}-${r*.52} ${r*.55}-${r*.52}s${r*.49} ${r*.16} ${r*.55} ${r*.52}" fill="none" stroke="#20201f" stroke-width="${r*.07}" stroke-linecap="round"/></g>`;
 return `<defs><clipPath id="avatarClip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
  <circle cx="${cx}" cy="${cy}" r="${r+r*.1}" fill="none" stroke="#efd369" stroke-width="${Math.max(4,r*.035)}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#f9f6ef"/>${photo}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#20201f" stroke-width="${Math.max(6,r*.05)}"/>
  <image href="${esc(d.huddles)}" x="${hx}" y="${hy}" width="${hudW}" height="${hud}" filter="url(#hudOutline)" data-role="huddles"/>`;
}
const defs=(d:ShareCardData,w:number,h:number)=>`<defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.sky[0]}"/><stop offset="1" stop-color="${d.sky[1]}"/></linearGradient>
 <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.6" fill="#20201f" opacity=".16"/></pattern>
 <pattern id="dotsLight" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f9f6ef"/><circle cx="3" cy="3" r="2" fill="#20201f" opacity=".14"/></pattern>
 <filter id="hudOutline" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="3" result="grow"/><feFlood flood-color="#fff"/><feComposite in2="grow" operator="in" result="white"/><feOffset in="grow" dx="6" dy="6" result="shift"/><feFlood flood-color="#20201f"/><feComposite in2="shift" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <linearGradient id="plastic" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".75"/><stop offset=".5" stop-color="#e9eef2" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff" stop-opacity=".7"/></linearGradient>
</defs><rect width="${w}" height="${h}" fill="url(#sky)"/><rect width="${w}" height="${h}" fill="url(#dots)"/>`;
const nameLine=(d:ShareCardData,x:number,y:number,size:number,fill:string,max:number)=>{const name=clip(d.name,max),width=name.length*size*.47;
 return `<text x="${x}" y="${y}" ${HEAD} font-size="${size}" fill="${fill}" data-role="name">${esc(name)}</text>${d.verified?rosette(x+width+12,y-size*.72,size*.62):''}`};

export function slabCardSvg(d:ShareCardData){
 const W=1080,H=1920,x=110,w=860;
 const window=d.cover?`<image href="${esc(d.cover)}" x="${x+50}" y="760" width="${w-100}" height="940" preserveAspectRatio="xMidYMid slice"/>`:`<rect x="${x+50}" y="760" width="${w-100}" height="940" fill="url(#sky)"/><rect x="${x+50}" y="760" width="${w-100}" height="940" fill="url(#dots)"/>`;
 const lines=[`@${d.handle} · Since ${d.since}`,`${d.comics.toLocaleString('en-US')} comics · ${d.keys.toLocaleString('en-US')} keys`,d.favoriteCharacter?`Favorite: ${d.favoriteCharacter}`:null,d.grail?`Grail: ${d.grail}`:null,d.trophy?`Trophy: ${d.trophy.name} · ${d.trophy.tier}`:null].filter(Boolean) as string[];
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-card="slab">${defs(d,W,H)}
  <rect x="${x-14}" y="96" width="${w+28}" height="1700" rx="46" fill="#20201f" opacity=".9" transform="translate(16 16)"/>
  <rect x="${x-14}" y="96" width="${w+28}" height="1700" rx="46" fill="url(#plastic)" stroke="#20201f" stroke-width="10"/>
  <rect x="${x+20}" y="130" width="${w-40}" height="560" rx="16" fill="#f9f6ef" stroke="#20201f" stroke-width="8"/>
  <rect x="${x+44}" y="156" width="210" height="190" fill="#c83e30" stroke="#20201f" stroke-width="6"/>
  <text x="${x+149}" y="276" text-anchor="middle" ${HEAD} font-size="120" fill="#fff">9.8</text>
  <text x="${x+149}" y="328" text-anchor="middle" ${HEAD} font-size="38" fill="#fff" letter-spacing="3">COLLECTOR</text>
  ${nameLine(d,x+280,236,82,'#20201f',14)}
  <text x="${x+282}" y="300" ${BODY} font-size="34" font-weight="700" fill="#20201f">${esc(d.verified?(d.verified==='business'?'Verified business':'Verified collector'):'ComicHuddle collector')}</text>
  ${lines.map((line,i)=>`<text x="${x+48}" y="${420+i*58}" ${BODY} font-size="36" fill="#20201f" font-weight="${i<2?700:500}">${esc(clip(line,40))}</text>`).join('')}
  <rect x="${x+50}" y="760" width="${w-100}" height="940" fill="#20201f"/>${window}
  <rect x="${x+50}" y="760" width="${w-100}" height="940" fill="none" stroke="#20201f" stroke-width="8"/>
  ${avatarBlock(d,W/2,1220,190)}
  <text x="${W/2}" y="1870" text-anchor="middle" ${HEAD} font-size="44" fill="#20201f">COMICHUDDLE.COM/@${esc(d.handle.toUpperCase())}</text>
 </svg>`;
}

export function tradingCardSvg(d:ShareCardData){
 const W=1080,H=1920,x=90,w=900,power:[string,number][]=[['Collecting',7],['Trading',6],['Bag & board',7],['Self-control',2]];
 const art=d.cover?`<image href="${esc(d.cover)}" x="${x+40}" y="190" width="${w-80}" height="760" preserveAspectRatio="xMidYMid slice"/>`:`<rect x="${x+40}" y="190" width="${w-80}" height="760" fill="url(#sky)"/><rect x="${x+40}" y="190" width="${w-80}" height="760" fill="url(#dots)"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-card="trading">${defs(d,W,H)}
  <rect x="${x}" y="110" width="${w}" height="1700" rx="30" fill="#20201f" transform="translate(18 18)"/>
  <rect x="${x}" y="110" width="${w}" height="1700" rx="30" fill="#efd369" stroke="#20201f" stroke-width="10"/>
  <rect x="${x+40}" y="190" width="${w-80}" height="760" fill="#20201f"/>${art}<rect x="${x+40}" y="190" width="${w-80}" height="760" fill="none" stroke="#20201f" stroke-width="8"/>
  <g><rect x="${x+w-250}" y="140" width="200" height="70" fill="#c83e30" stroke="#20201f" stroke-width="6"/><text x="${x+w-150}" y="190" text-anchor="middle" ${HEAD} font-size="44" fill="#fff">No. 0001</text></g>
  ${avatarBlock(d,W/2,800,170)}
  <rect x="${x+40}" y="1010" width="${w-80}" height="130" fill="#20201f"/>
  ${nameLine(d,x+70,1100,80,'#f9f6ef',15)}
  <text x="${x+70}" y="1200" ${BODY} font-size="36" font-weight="700" fill="#20201f">@${esc(d.handle)} · Since ${d.since} · ${d.comics.toLocaleString('en-US')} comics · ${d.keys.toLocaleString('en-US')} keys</text>
  <text x="${x+70}" y="1290" ${HEAD} font-size="54" fill="#20201f">POWER GRID</text>
  ${power.map(([label,score],i)=>{const y=1330+i*96;return `<text x="${x+70}" y="${y+48}" ${BODY} font-size="34" font-weight="700" fill="#20201f">${esc(label)}</text>${Array.from({length:7},(_,n)=>`<rect x="${x+380+n*62}" y="${y+12}" width="54" height="46" fill="${n<score?'#c83e30':'#f9f6ef'}" stroke="#20201f" stroke-width="5"/>`).join('')}<text x="${x+w-60}" y="${y+50}" text-anchor="end" ${HEAD} font-size="44" fill="#20201f">${score}</text>`}).join('')}
  ${d.trophy?`<text x="${x+70}" y="1760" ${BODY} font-size="32" font-weight="700" fill="#20201f">Trophy: ${esc(d.trophy.name)} · ${esc(d.trophy.tier)}</text>`:''}
  <text x="${W/2}" y="1880" text-anchor="middle" ${HEAD} font-size="44" fill="#20201f">COMICHUDDLE.COM/@${esc(d.handle.toUpperCase())}</text>
 </svg>`;
}
export const shareCardSvg=(style:ShareCardStyle,d:ShareCardData)=>style==='slab'?slabCardSvg(d):tradingCardSvg(d);
