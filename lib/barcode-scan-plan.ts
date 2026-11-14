// Shared decode plan for still photos (upload / "Use this frame"), used by the
// browser (canvas) and the server (sharp) so both read the same regions.
//
// Why: a phone photo is ~3000x4000 and a comic UPC (+5-digit add-on) is only
// 10-20% of the width, i.e. ~2 px per bar module at native resolution. The old
// path shrank the whole photo to 1500 px (<1 px/module) and made one attempt,
// which cannot work. Instead: crop the corners/edges where comic barcodes sit
// and decode them at (near) native resolution, enlarging small crops.
export type DecodeRegion={name:string;x:number;y:number;width:number;height:number;scale:number;rotations:1|2;sharpen:boolean|'only'};
type Box=[name:string,x0:number,y0:number,x1:number,y1:number];
// Fractions of the upright image. Corners overlap so a barcode on a border is whole in one tile.
const tiles:Box[]=[
 ['bottom-left',0,.6,.42,1],['bottom-right',.58,.6,1,1],['top-left',0,0,.42,.4],['top-right',.58,0,1,.4],
 ['bottom-left-wide',0,.45,.6,1],['bottom-right-wide',.4,.45,1,1],['top-left-wide',0,0,.6,.55],['top-right-wide',.4,0,1,.55],
 ['bottom-strip',0,.7,1,1],['center',.2,.25,.8,.75],
];
/**
 * maxPixels bounds the work per attempt (the browser runs these on a phone).
 * Tiles are decoded at native resolution (enlarging measured worse) after an
 * unsharp mask, which roughly doubled the hit rate on soft phone photos.
 */
export function photoDecodePlan(width:number,height:number,options:{maxPixels?:number;includeFull?:boolean}={}):DecodeRegion[]{
 if(!(width>0&&height>0))return [];
 const maxPixels=options.maxPixels||4_000_000,plan:DecodeRegion[]=[];
 if(options.includeFull!==false){const scale=Math.min(1,1600/Math.max(width,height));plan.push({name:'full',x:0,y:0,width,height,scale,rotations:2,sharpen:true})}
 for(const [name,x0,y0,x1,y1] of tiles){
  const x=Math.round(x0*width),y=Math.round(y0*height),w=Math.round((x1-x0)*width),h=Math.round((y1-y0)*height);
  const scale=Math.max(.25,Math.min(1,Math.sqrt(maxPixels/(w*h))));
  plan.push({name,x,y,width:w,height:h,scale:Number(scale.toFixed(3)),rotations:2,sharpen:'only'});
 }
 return plan;
}
