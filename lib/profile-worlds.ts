// Profile worlds (themes): one definition used by the profile page, the Theme screen, the share cards and the
// Open Graph image. Scenery is drawn with CSS gradients and SVG shapes only: no publisher places, no characters.
export type WorldId='classic'|'gargoyle'|'sunrise'|'newyork'|'cosmic'|'sanctum'|'neon'|'sunken'|'bayou'|'frontier';
export type InkId='golden'|'silver'|'bronze'|'modern'|'noir';
export type FrameId='circle'|'burst'|'panel'|'slab';
export type SfxId='POW!'|'ZAP!'|'KA-BOOM!'|'WHAM!'|'KRAK!'|'FWOOSH!';
export type ProfileWorld={id:WorldId;name:string;blurb:string;sky:[string,string];pattern:string;skyline:string;skylineColor:string};
const svg=(body:string,color:string)=>`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 120' preserveAspectRatio='none'><g fill='${color}'>${body}</g></svg>`)}")`;
const dots=(color:string,size=14,r=1.6)=>`radial-gradient(circle,${color} ${r}px,transparent ${r+.2}px) 0 0/${size}px ${size}px`;
// Skyline paths: simple silhouettes drawn for ComicHuddle (viewBox 400×120, ground at 120).
const SKYLINES:Record<WorldId,string>={
 classic:"<path d='M0 120V96h30V80h24v16h20V70h36v26h18V84h28v12h22V64h40v32h20V78h34v18h22V88h30v8h34V72h22v48z'/>",
 gargoyle:"<path d='M0 120V90l14-6V60l8-22 8 22v24l18 6V70h12V44l10-26 10 26v26h12v20l16-8V52l6-14 6 14v30l20 8V66h10l6-18 6 18h10v54zM260 120V74l12-10V40l8-20 8 20v24l12 10v46zM320 120V86h18V58l10-24 10 24v28h18V70l12-14 12 14v50z'/>",
 sunrise:"<path d='M0 120V92h26V70h8V58h10v12h8v22h22V50l6-8h12l6 8v70zM104 120V64h10V40h6v-8h8v8h6v24h10v56zM160 120V82h30V46l15-16 15 16v74zM230 120V72h12V54h8V40h10v14h8v18h12v48zM300 120V60l10-12h20l10 12v60zM350 120V88h50v32z'/>",
 newyork:"<path d='M0 120V84h40V60h10v-8h20v8h10v60zM90 120V70h16V56h4v-8h12v8h4v14h16v50zM150 120V90h20V62l8-6h4V40h10v16h4l8 6v58zM220 120V78h36V64h28v56zM290 120V58h8V46l10-8 10 8v12h8v62zM340 120V86h22V70h10v-8h10v8h18v50z'/><path d='M58 52h16v-8l-8-8-8 8zM196 38h12v-10h-12z'/>",
 cosmic:"<path d='M0 120c40-30 80-24 120-10s70 4 110-14 90-18 170 6v18z'/><circle cx='330' cy='40' r='18'/><circle cx='70' cy='30' r='8'/>",
 sanctum:"<path d='M0 120V96h40V80c0-20 30-20 30 0v16h30V70c0-30 50-30 50 0v50zM160 120V88h20V64c0-34 60-34 60 0v24h20v32zM270 120V92h26V78c0-18 28-18 28 0v14h26V70c0-24 40-24 40 0v50z'/>",
 neon:"<path d='M0 120V56h10V30h6v26h12V70h14V20h4V8h4v12h4v100zM70 120V44h8V24h4v20h8v76zM110 120V64h16V36h6V14h4v22h6v84zM170 120V52h10V28h4v24h10v68zM220 120V40h6V10h4v30h6v80zM260 120V60h18V30h8v30h12v60zM320 120V48h8V18h4v30h8v72zM360 120V66h14V40h6v26h20v54z'/>",
 sunken:"<path d='M0 120c10-20 20-30 34-30s16 14 26 14 14-20 30-20 18 22 30 22 18-30 40-30 22 30 36 30 16-14 30-14 20 18 36 18 18-26 40-26 26 26 40 26 24-12 48-12 30 14 50 22z'/><path d='M60 120V80l6-10 6 10v40zM300 120V70l4-14 4 14v50zM180 120V86c0-8 14-8 14 0v34z'/>",
 bayou:"<path d='M0 120c40-8 80-6 120 0s80 6 120 0 100-6 160 0v0z'/><path d='M40 120V60c-10-8-20-8-28-2 10-10 22-12 32-6V40c-6-6-14-8-22-6 8-6 18-6 24-2l6 88zM150 120V54c-8-6-18-6-26 0 8-10 20-12 28-6V30l4 90zM290 120V48c-8-6-18-6-26 0 8-10 20-12 28-6V26c-8-4-16-4-22 0 6-8 16-8 24-4l2 100zM360 120V70c-6-4-12-4-18 0 6-8 14-8 20-4l2 54z'/>",
 frontier:"<path d='M0 120V96h40l10-30h60l12 30h30V84l14-20h50l16 20v36zM250 120V90h20l8-24h44l10 24h68v30z'/><path d='M120 120V100h6v-14h6v14h6v20zM330 120V96h4V84h4v12h6v24z'/>",
};
export const WORLDS:readonly ProfileWorld[]=[
 {id:'classic',name:'Classic Huddle',blurb:'Yellow Ben-Day dots. The house look.',sky:['#efd369','#f3c94a'],pattern:dots('rgba(32,32,31,.16)'),skyline:svg(SKYLINES.classic,'rgba(32,32,31,.22)'),skylineColor:'rgba(32,32,31,.22)'},
 {id:'gargoyle',name:'Gargoyle City',blurb:'Night teal sky, moon, rain and gothic spires.',sky:['#123c44','#0a2228'],pattern:'radial-gradient(circle at 82% 16%,#f4efd2 0 28px,rgba(244,239,210,.25) 30px,transparent 60px),repeating-linear-gradient(105deg,rgba(255,255,255,.08) 0 1px,transparent 1px 18px)',skyline:svg(SKYLINES.gargoyle,'#071418'),skylineColor:'#071418'},
 {id:'sunrise',name:'Sunrise City',blurb:'Blue-to-gold morning, sun rays, art-deco towers.',sky:['#5b8fd6','#f2c66b'],pattern:'repeating-conic-gradient(from 0deg at 50% 100%,rgba(255,240,190,.28) 0 6deg,transparent 6deg 14deg)',skyline:svg(SKYLINES.sunrise,'#2d4363'),skylineColor:'#2d4363'},
 {id:'newyork',name:'New York Rooftops',blurb:'Purple-to-orange dusk, water towers, lit windows.',sky:['#4b2c6b','#f08a4b'],pattern:dots('rgba(255,214,120,.35)',22,1.4),skyline:svg(SKYLINES.newyork,'#24162f'),skylineColor:'#24162f'},
 {id:'cosmic',name:'Cosmic Edge',blurb:'Purple space, stars, black crackle dots, planets.',sky:['#2a1048','#0d0620'],pattern:`${dots('rgba(255,255,255,.7)',37,1)},${dots('rgba(0,0,0,.55)',19,3)}`,skyline:svg(SKYLINES.cosmic,'#140a26'),skylineColor:'#140a26'},
 {id:'sanctum',name:'Mystic Sanctum',blurb:'Deep purple, glowing rings and domes.',sky:['#3c1f5c','#1c0f2e'],pattern:'radial-gradient(circle at 50% 30%,transparent 0 60px,rgba(255,196,92,.35) 61px 63px,transparent 64px 90px,rgba(255,196,92,.22) 91px 93px,transparent 94px)',skyline:svg(SKYLINES.sanctum,'#120a1c'),skylineColor:'#120a1c'},
 {id:'neon',name:'Neon Megacity',blurb:'Dark sky, teal and pink grid, tall thin towers.',sky:['#0c0f1e','#1a0d26'],pattern:'linear-gradient(rgba(127,224,214,.18) 1px,transparent 1px) 0 0/28px 28px,linear-gradient(90deg,rgba(255,92,190,.16) 1px,transparent 1px) 0 0/28px 28px',skyline:svg(SKYLINES.neon,'#05060d'),skylineColor:'#05060d'},
 {id:'sunken',name:'Sunken Kingdom',blurb:'Deep blue, light rays, bubbles and coral.',sky:['#1b5f8a','#0b2944'],pattern:`repeating-linear-gradient(100deg,rgba(255,255,255,.08) 0 18px,transparent 18px 60px),${dots('rgba(255,255,255,.35)',41,2.4)}`,skyline:svg(SKYLINES.sunken,'#082033'),skylineColor:'#082033'},
 {id:'bayou',name:'Haunted Bayou',blurb:'Swamp green, fog, fireflies, cypress shapes.',sky:['#2e4a32','#14241a'],pattern:`linear-gradient(transparent 55%,rgba(220,230,210,.18) 70%,transparent 85%),${dots('rgba(240,232,120,.6)',53,1.8)}`,skyline:svg(SKYLINES.bayou,'#0b150e'),skylineColor:'#0b150e'},
 {id:'frontier',name:'Frontier Town',blurb:'Orange desert sky, big sun and mesas.',sky:['#f08a3c','#f7c873'],pattern:'radial-gradient(circle at 70% 70%,#ffe08a 0 54px,rgba(255,224,138,.35) 56px,transparent 90px)',skyline:svg(SKYLINES.frontier,'#7a3a1a'),skylineColor:'#7a3a1a'},
];
export const INKS:readonly {id:InkId;name:string;a:string;b:string;text:string}[]=[
 {id:'golden',name:'Golden Age',a:'#c83e30',b:'#efd369',text:'#ffffff'},
 {id:'silver',name:'Silver Age',a:'#345a6a',b:'#c83e30',text:'#ffffff'},
 {id:'bronze',name:'Bronze Age',a:'#8a4b16',b:'#e3c9a0',text:'#ffffff'},
 {id:'modern',name:'Modern Age',a:'#20201f',b:'#7fe0d6',text:'#7fe0d6'},
 {id:'noir',name:'Noir',a:'#20201f',b:'#f9f6ef',text:'#f9f6ef'},
];
export const FRAMES:readonly {id:FrameId;name:string}[]=[{id:'circle',name:'Thin ring'},{id:'burst',name:'Starburst'},{id:'panel',name:'Panel'},{id:'slab',name:'Slab'}];
export const SFX:readonly SfxId[]=['POW!','ZAP!','KA-BOOM!','WHAM!','KRAK!','FWOOSH!'];
export type ProfileLook={world:WorldId;ink:InkId;frame:FrameId;sfx:SfxId};
export const DEFAULT_LOOK:ProfileLook={world:'classic',ink:'golden',frame:'circle',sfx:'POW!'};
export const worldFor=(id:string|null|undefined)=>WORLDS.find(world=>world.id===id)||WORLDS[0];
export const inkFor=(id:string|null|undefined)=>INKS.find(ink=>ink.id===id)||INKS[0];
export const isWorld=(v:unknown):v is WorldId=>WORLDS.some(w=>w.id===v);
export const isInk=(v:unknown):v is InkId=>INKS.some(i=>i.id===v);
export const isFrame=(v:unknown):v is FrameId=>FRAMES.some(f=>f.id===v);
export const isSfx=(v:unknown):v is SfxId=>(SFX as readonly string[]).includes(v as string);
export const lookFrom=(row:{world?:unknown;ink?:unknown;frame?:unknown;sfx?:unknown}|null|undefined):ProfileLook=>({world:isWorld(row?.world)?row!.world as WorldId:'classic',ink:isInk(row?.ink)?row!.ink as InkId:'golden',frame:isFrame(row?.frame)?row!.frame as FrameId:'circle',sfx:isSfx(row?.sfx)?row!.sfx as SfxId:'POW!'});
/** CSS custom properties for the profile wallpaper and ink. */
export function lookStyle(look:ProfileLook):Record<string,string>{
 const w=worldFor(look.world),i=inkFor(look.ink);
 return {'--pp-sky':`linear-gradient(180deg,${w.sky[0]},${w.sky[1]})`,'--pp-pattern':w.pattern,'--pp-skyline':w.skyline,'--pp-ink-a':i.a,'--pp-ink-b':i.b,'--pp-ink-text':i.text};
}
