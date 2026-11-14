// Realistic synthetic "phone photo of a comic cover" fixtures, generated in memory.
// bwip-js renders a real UPC-A + 5-digit add-on (bars ~0.65x the main-symbol width, as printed on US comics); sharp places it in a cover corner
// at 10-20% of the width, then applies rotation, shear (perspective-like), blur,
// glare, JPEG q60 and, for some, EXIF orientation. Nothing is written to disk.
import bwipjs from 'bwip-js';
import sharp from 'sharp';

export type BarcodePhoto={name:string;bytes:Buffer;value:string;supplement:string};
function check(digits:string){let sum=0;for(let i=0;i<digits.length;i++)sum+=Number(digits[i])*(i%2?1:3);return digits+((10-sum%10)%10)}
function rng(seed:number){return ()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648}}

async function coverBackground(width:number,height:number,random:()=>number){
 const hue=Math.floor(random()*360),shapes=Array.from({length:14},()=>`<rect x="${Math.floor(random()*width)}" y="${Math.floor(random()*height)}" width="${Math.floor(200+random()*900)}" height="${Math.floor(200+random()*900)}" fill="hsl(${Math.floor(random()*360)},70%,${Math.floor(30+random()*40)}%)" opacity="0.8" transform="rotate(${Math.floor(random()*40-20)})"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${(hue+120)%360},60%,25%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes}<text x="${width*.08}" y="${height*.14}" font-size="${width*.11}" font-family="Arial Black,Arial" font-weight="900" fill="#fff" stroke="#000" stroke-width="8">THE AMAZING</text><text x="${width*.75}" y="${height*.06}" font-size="${width*.05}" font-family="Arial" fill="#ff0">#311</text></svg>`;
 return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function barcodePhotos(count=20):Promise<BarcodePhoto[]>{
 const out:BarcodePhoto[]=[];const random=rng(20261114);
 const corners=['bottom-left','bottom-right','top-left','bottom-left'] as const;
 for(let index=0;index<count;index++){
  const value=check('7'+String(Math.floor(random()*1e10)).padStart(10,'0')),supplement=String(Math.floor(random()*900)+1).padStart(3,'0')+'1'+String(1+Math.floor(random()*3));
  const width=3000,height=4000,fraction=.10+(index%6)*.02,corner=corners[index%corners.length];
  const code=await bwipjs.toBuffer({bcid:'upca',text:value+' '+supplement,scale:4,height:24,includetext:true,textxalign:'center',paddingwidth:12,paddingheight:8,backgroundcolor:'FFFFFF'});
  const targetWidth=Math.round(width*fraction),label=await sharp(code).resize({width:targetWidth,kernel:'lanczos3'}).png().toBuffer(),meta=await sharp(label).metadata();
  const left=corner.endsWith('left')?Math.round(width*.05):Math.round(width*.95-targetWidth),top=corner.startsWith('bottom')?Math.round(height*.93-(meta.height||0)):Math.round(height*.05);
  const background=await coverBackground(width,height,random);
  const glareX=left+targetWidth*(.2+random()*.6),glareY=top+(meta.height||0)*.5,glare=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><radialGradient id="r" cx="${glareX}" cy="${glareY}" r="${targetWidth*.45}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="${.35+random()*.25}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#r)"/></svg>`;
  let image=sharp(background).composite([{input:label,left,top},{input:Buffer.from(glare),left:0,top:0}]);
  let buffer=await image.png().toBuffer();
  // Hand-held: rotation +/-8 degrees and a mild shear standing in for perspective.
  const angle=(random()*16-8),shear=(random()*.08-.04);
  buffer=await sharp(buffer).affine([[1,shear],[shear*.5,1]],{background:'#202020'}).rotate(angle,{background:'#202020'}).resize({width,height,fit:'cover'}).png().toBuffer();
  let photo=sharp(buffer).blur(.6+random()*.9).modulate({brightness:.85+random()*.3});
  const exif=index%5===2;
  if(exif)photo=sharp(await photo.png().toBuffer()).rotate(-90).withMetadata({orientation:6});
  const bytes=await photo.jpeg({quality:60}).toBuffer();
  out.push({name:`photo-${index}-${corner}-${Math.round(fraction*100)}pct-rot${angle.toFixed(1)}${exif?'-exif6':''}`,bytes,value,supplement});
 }
 return out;
}
