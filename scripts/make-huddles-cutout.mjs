// One-off: builds public/mascot/huddles-cutout.webp from huddles-30-portrait.webp by removing the yellow
// dotted glow behind Mr. Huddles. Flood-fills from the image edges through transparent pixels and warm/light
// glow pixels (yellow, cream, orange, white); it stops at his dark outline, so the yellow "C" on his chest
// (enclosed by the outline) is kept. Then trims to the content. Run: node scripts/make-huddles-cutout.mjs
import sharp from 'sharp';
const src='public/mascot/huddles-30-portrait.webp',out='public/mascot/huddles-cutout.webp';
const {data,info}=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const {width:w,height:h}=info,px=new Uint8Array(data);
// Glow: transparent, or light and warm (red and green both high: yellow, orange, cream, white). The red cape has low green.
const glow=i=>{const r=px[i],g=px[i+1],b=px[i+2],a=px[i+3];return a<48||(r>170&&g>130&&r>=b)};
const seen=new Uint8Array(w*h),stack=[];
for(let x=0;x<w;x++){stack.push(x,(h-1)*w+x)}for(let y=0;y<h;y++){stack.push(y*w,y*w+w-1)}
while(stack.length){const p=stack.pop();if(seen[p])continue;if(!glow(p*4))continue;seen[p]=1;const x=p%w,y=(p-x)/w;
 if(x>0)stack.push(p-1);if(x<w-1)stack.push(p+1);if(y>0)stack.push(p-w);if(y<h-1)stack.push(p+w)}
let removed=0;for(let p=0;p<w*h;p++)if(seen[p]){px[p*4+3]=0;removed++}
// Soften a one-pixel light fringe left next to the removed area.
for(let p=0;p<w*h;p++){if(seen[p]||px[p*4+3]===0)continue;const x=p%w,y=(p-x)/w;const near=(x>0&&seen[p-1])||(x<w-1&&seen[p+1])||(y>0&&seen[p-w])||(y<h-1&&seen[p+w]);
 if(near&&px[p*4]>150&&px[p*4+1]>110)px[p*4+3]=Math.round(px[p*4+3]*.35)}
await sharp(Buffer.from(px),{raw:{width:w,height:h,channels:4}}).trim({threshold:1}).webp({quality:90,alphaQuality:100}).toFile(out);
const meta=await sharp(out).metadata();console.log(`removed ${removed} glow pixels; ${out} is ${meta.width}x${meta.height}`);
