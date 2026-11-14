// Independent UPC/EAN 2- and 5-digit add-on ("supplement") reader.
//
// @zxing/library 0.21 detects the add-on but loses its digits: in
// UPCEANExtension5Support.decodeRow the digits are appended to a local string
// copy, so UPC_EAN_EXTENSION metadata is always ''. On US comics the 5-digit
// add-on is what identifies the issue/variant/printing, so we read it here from
// the same luminance row, starting just after the main barcode's end guard.
type Point={getX():number;getY():number};
const L=[[3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],[1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]];
const G=L.map(pattern=>[...pattern].reverse());
const CHECK5=[0x18,0x14,0x12,0x11,0x0c,0x06,0x03,0x0a,0x09,0x05];
function variance(runs:number[],pattern:number[]){const total=runs.reduce((a,b)=>a+b,0),unit=total/7;let sum=0;for(let i=0;i<4;i++)sum+=Math.abs(runs[i]-pattern[i]*unit);return sum/total}
function digit(runs:number[]){let best={value:-1,g:false,score:.5};for(let d=0;d<10;d++){const l=variance(runs,L[d]),g=variance(runs,G[d]);if(l<best.score)best={value:d,g:false,score:l};if(g<best.score)best={value:d,g:true,score:g}}return best.value<0?null:best}
function checksum5(s:string){const n=[...s].map(Number);return ((n[1]+n[3])*3+n[0]+n[2]+n[4])*3%10}
/** Run lengths (bar/space alternating) of one row segment, starting with a space. */
function runsOf(row:Float32Array,window:number){
 let min=255,max=0;for(const v of row){if(v<min)min=v;if(v>max)max=v}
 if(max-min<40)return null;const runs:number[]=[];let dark=false,length=0;
 // Local mid-range threshold: glare and print gradients vary along the row.
 const half=Math.max(4,Math.round(window/2));
 for(let i=0;i<row.length;i++){let lo=255,hi=0;for(let j=Math.max(0,i-half);j<Math.min(row.length,i+half);j++){if(row[j]<lo)lo=row[j];if(row[j]>hi)hi=row[j]}const threshold=hi-lo<25?(min+max)/2:(lo+hi)/2;const isDark=row[i]<threshold;if(isDark===dark)length++;else{runs.push(length);length=1;dark=isDark}}
 runs.push(length);return runs;// runs[0] is the leading space (may be 0)
}
function decodeRuns(runs:number[],module:number):string{
 // Skip the quiet gap; find guard bar(1) space(1) bar(2).
 for(let start=1;start+3<runs.length;start+=2){
  const [b1,s1,b2]=runs.slice(start,start+3),unit=(b1+s1+b2)/4;
  if(Math.abs(unit-module)>module*.6||b2<b1*1.2||b2<s1*1.2)continue;
  for(const count of [5,2]){
   let index=start+3,text='',lg=0,ok=true;
   for(let x=0;x<count;x++){
    const four=runs.slice(index,index+4);if(four.length<4){ok=false;break}
    const read=digit(four);if(!read){ok=false;break}
    text+=read.value;if(read.g)lg|=1<<(count-1-x);index+=4;
    if(x<count-1){const sep=runs.slice(index,index+2);if(sep.length<2||sep[0]>unit*2.2||sep[1]>unit*2.2){ok=false;break}index+=2}
   }
   if(!ok)continue;
   if(count===5&&CHECK5.indexOf(lg)===checksum5(text))return text;
   if(count===2&&Number(text)%4===lg)return text;
  }
 }
 return '';
}
/**
 * luma: the exact (possibly rotated) luminance image the main barcode was read from.
 * points: the main result's points (start-guard centre, end-guard centre[, add-on points]).
 */
export function readAddon(luma:Uint8ClampedArray,width:number,height:number,points:Point[]|null|undefined):string{
 if(!points||points.length<2)return '';
 const a=points[0],b=points[1],y0=Math.round((a.getY()+b.getY())/2),forward=b.getX()>a.getX();
 const module=Math.abs(b.getX()-a.getX())/92;if(!(module>.6))return '';
 const startX=b.getX()+(forward?1.5:-1.5)*module,length=Math.ceil(module*62);
 // Add-on bars start below the digits printed above them: try rows around and below the hit row.
 const offsets=[0,4,8,12,16,-4,20,24,-8,30,36];
 for(const offset of offsets){
  const y=y0+Math.round(offset*module);if(y<0||y>=height)continue;
  const row=new Float32Array(length);let valid=0;
  for(let i=0;i<length;i++){const x=Math.round(forward?startX+i:startX-i);if(x<0||x>=width)break;
   // Average three rows to suppress JPEG noise.
   let sum=0,n=0;for(const dy of [-1,0,1]){const yy=y+dy;if(yy>=0&&yy<height){sum+=luma[yy*width+x];n++}}row[i]=sum/n;valid=i+1}
  if(valid<module*40)continue;
  const runs=runsOf(row.subarray(0,valid),module*8);if(!runs)continue;
  const text=decodeRuns(runs,module);if(text)return text;
 }
 return '';
}
