export type ComicIdentifier={identifier:string;base:string;lookupKey:string;supplement:string;kind:'UPC'|'EAN'|'ISBN'};
function gtinValid(value:string){if(!/^\d+$/.test(value))return false;let sum=0;for(let index=value.length-2,weight=3;index>=0;index--,weight=weight===3?1:3)sum+=Number(value[index])*weight;return (10-sum%10)%10===Number(value.at(-1))}
function isbn10Valid(value:string){return /^\d{9}[\dX]$/.test(value)&&[...value].reduce((sum,c,index)=>sum+(c==='X'?10:Number(c))*(10-index),0)%11===0}
function isbn13(value:string){const first='978'+value.slice(0,9);let sum=0;for(let i=0;i<12;i++)sum+=Number(first[i])*(i%2?3:1);return first+(10-sum%10)%10}
/** Preserve extensions. A base code is a candidate lookup, never edition proof. */
export function parseComicIdentifier(value:string,extension='',format=''):ComicIdentifier|null{
 if(value.length>80||extension.length>8)return null;
 const cleaned=value.trim().toUpperCase().replace(/^(?:ISBN(?:-1[03])?|UPC|EAN)\s*:?\s*/,'').replace(/[\s-]/g,'');
 let base=cleaned,supplement=extension.replace(/\s/g,'');
 if(cleaned.length===17&&!supplement){base=cleaned.slice(0,12);supplement=cleaned.slice(12)}
 else if(cleaned.length===18&&!supplement){base=cleaned.slice(0,13);supplement=cleaned.slice(13)}
 else if(cleaned.length===14&&!supplement&&gtinValid(cleaned.slice(0,12))){base=cleaned.slice(0,12);supplement=cleaned.slice(12)}
 else if(cleaned.length===15&&!supplement&&gtinValid(cleaned.slice(0,13))){base=cleaned.slice(0,13);supplement=cleaned.slice(13)}
 if(supplement&&!/^(?:\d{2}|\d{5})$/.test(supplement))return null;
 if(format.replace(/_/g,'').toUpperCase()==='UPCE'){
  if(!/^[01]\d{7}$/.test(base))return null;const digits=base.slice(1,7),last=digits[5];
  const body='012'.includes(last)?digits.slice(0,2)+last+'0000'+digits.slice(2,5):last==='3'?digits.slice(0,3)+'00000'+digits.slice(3,5):last==='4'?digits.slice(0,4)+'00000'+digits[4]:digits.slice(0,5)+'0000'+last;
  const expanded=base[0]+body+base[7];if(!gtinValid(expanded))return null;
  return {identifier:base+supplement,base,lookupKey:'0'+expanded,supplement,kind:'UPC'};
 }
 if(base.length===10&&isbn10Valid(base))return {identifier:base+supplement,base,lookupKey:isbn13(base),supplement,kind:'ISBN'};
 if(![8,12,13].includes(base.length)||!gtinValid(base))return null;
 return {identifier:base+supplement,base,lookupKey:base.length===12?'0'+base:base,supplement,kind:base.startsWith('978')||base.startsWith('979')?'ISBN':base.length===12?'UPC':'EAN'};
}
export function identifiersFromRecord(raw:{barcode?:unknown;isbn?:unknown;valid_isbn?:unknown}){
 const found=new Map<string,ComicIdentifier>();
 for(const value of [raw.barcode,raw.isbn,raw.valid_isbn])if(typeof value==='string')for(const part of value.split(/[;,\n]|\s+\/\s+/)){const code=parseComicIdentifier(part);if(code)found.set(code.identifier,code)}
 return [...found.values()];
}
