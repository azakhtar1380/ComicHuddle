import {ApiRequestError} from './api-security';

// Parse bounded image containers and remove common location/text metadata before
// storage. This is not an image decoder or an authenticity check. Client uploads
// are also resized, but server validation never relies on that preparation.
const invalid=()=>new ApiRequestError('Upload a valid, still JPEG, PNG or WebP photo.',400);
const be16=(b:Uint8Array,i:number)=>(b[i]<<8)|b[i+1];
const be32=(b:Uint8Array,i:number)=>b[i]*0x1000000+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3];
const le24=(b:Uint8Array,i:number)=>b[i]+(b[i+1]<<8)+(b[i+2]<<16);
const le32=(b:Uint8Array,i:number)=>(b[i]+(b[i+1]<<8)+(b[i+2]<<16)+b[i+3]*0x1000000)>>>0;
const word=(b:Uint8Array,i:number,n:number)=>String.fromCharCode(...b.slice(i,i+n));
function dimensions(width:number,height:number){
 if(!width||!height||width>4800||height>4800||width*height>16000000)throw new ApiRequestError('Photos must be at most 4,800 pixels per side and 16 megapixels. Resize the original and retry.',400);
}
function join(parts:Uint8Array[]){const out=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}return out}

function jpeg(b:Uint8Array){
 const parts=[b.slice(0,2)];let i=2,width=0,height=0,sawScan=false;
 while(i<b.length){
  const start=i;if(b[i++]!==255)throw invalid();while(b[i]===255)i++;const marker=b[i++];
  if(marker===0xd9){if(!width||!height||!sawScan||i!==b.length)throw invalid();parts.push(b.slice(start,i));return join(parts)}
  if(marker===undefined||marker===0||marker===0xd8||marker>=0xd0&&marker<=0xd7)throw invalid();
  if(marker===0x01){parts.push(b.slice(start,i));continue}
  if(i+2>b.length)throw invalid();const size=be16(b,i),end=i+size;if(size<2||end>b.length)throw invalid();
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(size<8||size<8+3*b[i+7])throw invalid();height=be16(b,i+3);width=be16(b,i+5);dimensions(width,height);
  }
  if(marker===0xda){
   if(!width||!height||size<6||size!==6+2*b[i+2])throw invalid();sawScan=true;parts.push(b.slice(start,end));
   // Entropy-coded bytes escape 0xff as 0xff00; restart markers also stay
   // inside the scan. Other markers return to the normal segment parser, so
   // progressive images cannot conceal EXIF/XMP between later scans.
   const scanStart=end;i=end;
   while(i<b.length){if(b[i]!==255){i++;continue}let next=i+1;while(b[next]===255)next++;const code=b[next];if(code===0||code>=0xd0&&code<=0xd7){i=next+1;continue}break}
   if(i===b.length)throw invalid();parts.push(b.slice(scanStart,i));continue;
  }
  // APP1 contains EXIF/XMP, APP13 IPTC, and COM arbitrary text. Preserve JFIF
  // and Adobe color interpretation; discard other application metadata.
  if(!(marker>=0xe0&&marker<=0xef&&marker!==0xe0&&marker!==0xee)&&marker!==0xfe)parts.push(b.slice(start,end));
  i=end;
 }
 throw invalid();
}

function png(b:Uint8Array){
 const signature=[137,80,78,71,13,10,26,10];if(signature.some((v,i)=>b[i]!==v))throw invalid();
 const parts=[b.slice(0,8)];let i=8,header=false,pixels=false;
 while(i+12<=b.length){const size=be32(b,i),type=word(b,i+4,4),end=i+12+size;if(end>b.length)throw invalid();
  if(!header){if(type!=='IHDR'||size!==13)throw invalid();dimensions(be32(b,i+8),be32(b,i+12));if(![1,2,4,8,16].includes(b[i+16])||![0,2,3,4,6].includes(b[i+17])||b[i+18]!==0||b[i+19]!==0||b[i+20]>1)throw invalid();header=true}
  else if(type==='IHDR')throw invalid();
  if(['acTL','fcTL','fdAT'].includes(type))throw invalid();
  if(type==='IDAT'){if(!size)throw invalid();pixels=true}
  if(!['eXIf','tEXt','zTXt','iTXt','tIME'].includes(type))parts.push(b.slice(i,end));
  if(type==='IEND'){if(size!==0||!pixels||end!==b.length)throw invalid();return join(parts)}i=end;
 }
 throw invalid();
}

function webp(b:Uint8Array){
 if(le32(b,4)!==b.length-8||word(b,8,4)!=='WEBP')throw invalid();
 const parts:Uint8Array[]=[];let i=12,canvasWidth=0,canvasHeight=0,width=0,height=0,images=0;
 while(i+8<=b.length){const type=word(b,i,4),size=le32(b,i+4),data=i+8,end=data+size+(size%2);if(end>b.length)throw invalid();
  let chunk=b.slice(i,end);
  if(type==='VP8X'){if(size!==10||b[data]&2)throw invalid();canvasWidth=le24(b,data+4)+1;canvasHeight=le24(b,data+7)+1;dimensions(canvasWidth,canvasHeight);chunk[8]&=~12}
  if(type==='VP8 '){if(size<10||b[data]&1||word(b,data+3,3)!=='\x9d\x01\x2a')throw invalid();width=(b[data+6]+(b[data+7]<<8))&16383;height=(b[data+8]+(b[data+9]<<8))&16383;images++}
  if(type==='VP8L'){if(size<5||b[data]!==0x2f)throw invalid();const bits=le32(b,data+1);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;images++}
  if(type==='ANIM'||type==='ANMF')throw invalid();
  if(['VP8X','VP8 ','VP8L','ALPH','ICCP'].includes(type))parts.push(chunk);i=end;
 }
 if(i!==b.length||images!==1||canvasWidth&&(canvasWidth!==width||canvasHeight!==height))throw invalid();dimensions(width,height);
 const out=join([b.slice(0,12),...parts]),size=out.length-8;out[4]=size&255;out[5]=(size>>>8)&255;out[6]=(size>>>16)&255;out[7]=(size>>>24)&255;return out;
}

export function prepareImage(bytes:Uint8Array):{bytes:Uint8Array;contentType:string}{
 if(bytes.length<16)throw invalid();
 if(bytes[0]===255&&bytes[1]===216)return {bytes:jpeg(bytes),contentType:'image/jpeg'};
 if(bytes[0]===137&&word(bytes,1,3)==='PNG')return {bytes:png(bytes),contentType:'image/png'};
 if(word(bytes,0,4)==='RIFF')return {bytes:webp(bytes),contentType:'image/webp'};
 throw invalid();
}
