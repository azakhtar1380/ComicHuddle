import {coverCandidateCrops,describeCoverPixels,type CoverCrop,type CoverDescriptor,type PixelImage} from './cover-recognition';
export type CoverSignature={hash:string;descriptor:CoverDescriptor};
const size=32,frequencies=8;
const cosine=Array.from({length:frequencies},(_,k)=>Array.from({length:size},(_,x)=>Math.cos((2*x+1)*k*Math.PI/(2*size))));

/** 64-bit low-frequency DCT hash; luminance suppresses color-temperature shifts. */
export function perceptualCoverHash(image:PixelImage,crop:CoverCrop={x:0,y:0,width:image.width,height:image.height}){
 const gray=new Float64Array(size*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const px=Math.min(image.width-1,Math.max(0,Math.floor(crop.x+(x+.5)*crop.width/size))),py=Math.min(image.height-1,Math.max(0,Math.floor(crop.y+(y+.5)*crop.height/size))),i=(py*image.width+px)*4;
  gray[y*size+x]=.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2];
 }
 const coefficients:number[]=[];
 for(let v=0;v<frequencies;v++)for(let u=0;u<frequencies;u++){
  let sum=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)sum+=gray[y*size+x]*cosine[u][x]*cosine[v][y];
  coefficients.push(sum);
 }
 const ordered=coefficients.slice(1).sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length/2)];
 let hash=BigInt(0);for(let i=0;i<64;i++)hash=(hash<<BigInt(1))|(i>0&&coefficients[i]>median?BigInt(1):BigInt(0));
 return hash.toString(16).padStart(16,'0');
}
export function hashBits(hash:string){if(!/^[a-f0-9]{16}$/.test(hash))throw Error('Invalid cover hash.');return BigInt('0x'+hash).toString(2).padStart(64,'0')}
export function hashDistance(a:string,b:string){let bits=BigInt('0x'+a)^BigInt('0x'+b),count=0;while(bits){bits&=bits-BigInt(1);count++}return count}
export function coverSignatures(image:PixelImage,options:{mode:'camera'|'upload';viewportWidth?:number;viewportHeight?:number}):CoverSignature[]{
 const crops=coverCandidateCrops(image.width,image.height,options),chosen=crops.filter((_,i)=>i===0||i%3===1).slice(0,10);
 return chosen.flatMap(crop=>{const descriptor=describeCoverPixels(image,crop);if(descriptor.contrast<.04)return [];return [{hash:perceptualCoverHash(image,crop),descriptor:{...descriptor,luma:descriptor.luma.map(round),chroma:descriptor.chroma.map(round),edges:descriptor.edges.map(round)}}]});
}
const round=(value:number)=>Math.round(value*10000)/10000;
