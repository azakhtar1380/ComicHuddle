// Cover frames stay proportional across phones, tablets and the hosted app preview.
export type ArtVariant='grid'|'hero'|'thumbnail'|'detail'|'swipe';
const ratio=.74;
// Two equal three-tab groups keep the primary action at the actual center.
// At 320px: 6 x 44px tabs + 48px Scan + 8px rail padding/borders.
export function dockFrame(viewportWidth:number,horizontalInsets=0){
 const availableWidth=viewportWidth-horizontalInsets;
 const width=Math.min(650,availableWidth-(availableWidth>=352?24:0));
 const scanDiameter=Math.max(44,Math.min(56,width-272));
 return {width,scanDiameter,tabWidth:(width-8-scanDiameter)/6};
}
export function coverFrame(variant:ArtVariant,viewportWidth:number,viewportHeight:number){
 const pageWidth=Math.min(720,Math.max(240,viewportWidth));
 let width:number;
 switch(variant){
  case 'hero':width=105;break;
  case 'thumbnail':width=38;break;
  case 'detail':width=Math.min(142,(pageWidth-65)*.35);break;
  case 'swipe':width=Math.min(185,Math.max(80,(viewportHeight-460)*ratio),(pageWidth-88)*.74);break;
  default:width=Math.min(152,((pageWidth-40)*.478)-20);
 }
 return {width:Math.round(width),height:Math.round(width/ratio)};
}
