'use client';
// Local-pickup QR code, generated in the browser with the QR encoder already in @zxing/library (no
// network, no paid service). Payload "CHPICKUP:<orderId>:<6-digit code>" so a scan can't be applied
// to a different order. The server still verifies the code against the order's stored hash.
import {useEffect,useState} from 'react';

export const pickupPayload=(orderId:string,code:string)=>'CHPICKUP:'+orderId+':'+code;
/** Reads a scanned payload. Returns the 6-digit code when it belongs to this order. */
export function parsePickupPayload(value:string,orderId:string):{code:string}|{error:string}{
 const text=value.trim();
 if(/^\d{6}$/.test(text))return {code:text};
 const match=/^CHPICKUP:([^:]{1,100}):(\d{6})$/.exec(text);
 if(!match)return {error:'That QR code isn’t a ComicHuddle pickup code.'};
 if(match[1]!==orderId)return {error:'That pickup code belongs to a different order.'};
 return {code:match[2]};
}

export default function PickupQr({orderId,code,size=168}:{orderId:string;code:string;size?:number}){
 const [cells,setCells]=useState<{n:number;path:string}|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let live=true;void import('@zxing/library').then(({QRCodeEncoder,QRCodeDecoderErrorCorrectionLevel})=>{
  const matrix=QRCodeEncoder.encode(pickupPayload(orderId,code),QRCodeDecoderErrorCorrectionLevel.M).getMatrix(),n=matrix.getWidth();let path='';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(matrix.get(x,y)===1)path+=`M${x+4} ${y+4}h1v1h-1z`;
  if(live)setCells({n:n+8,path});
 }).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[orderId,code]);
 if(failed)return null;
 if(!cells)return <span className="pickup-qr pickup-qr-loading" style={{width:size,height:size}} aria-hidden="true"/>;
 return <svg className="pickup-qr" width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" role="img" aria-label="Pickup QR code for the seller to scan"><rect width={cells.n} height={cells.n} fill="#fff"/><path d={cells.path} fill="#000"/></svg>;
}
