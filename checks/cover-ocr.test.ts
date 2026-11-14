// Free-path fixtures: synthetic phone photos of covers with no readable barcode,
// read by real Tesseract (same engine and views as the browser), then matched
// against the starter catalog with the shared hint extraction and ranking.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {createWorker,PSM,type Worker} from 'tesseract.js';
import {extractComicHints,rankCatalogCandidates,type OcrLine,type OcrRegion} from '../lib/cover-ocr';
import {catalog} from '../lib/catalog';

const require=createRequire(import.meta.url);
type Cover={title:string[];number:string;publisher:string;month:string;year:number;expect:{title:string;number:string}};
const covers:Cover[]=[
 {title:['AMAZING','SPIDER-MAN'],number:'300',publisher:'MARVEL COMICS GROUP',month:'MAY',year:1988,expect:{title:'Amazing Spider-Man',number:'300'}},
 {title:['BATMAN'],number:'423',publisher:'DC COMICS',month:'SEPT',year:1988,expect:{title:'Batman',number:'423'}},
 {title:['INVINCIBLE'],number:'1',publisher:'IMAGE COMICS',month:'JAN',year:2003,expect:{title:'Invincible',number:'1'}},
 {title:['FANTASTIC','FOUR'],number:'48',publisher:'MARVEL COMICS GROUP',month:'MAR',year:1966,expect:{title:'Fantastic Four',number:'48'}},
 {title:['NEW','MUTANTS'],number:'98',publisher:'MARVEL',month:'FEB',year:1991,expect:{title:'New Mutants',number:'98'}},
 {title:['SPAWN'],number:'1',publisher:'IMAGE',month:'MAY',year:1992,expect:{title:'Spawn',number:'1'}},
 {title:['WATCHMEN'],number:'1',publisher:'DC',month:'SEPT',year:1986,expect:{title:'Watchmen',number:'1'}},
 {title:['INCREDIBLE','HULK'],number:'181',publisher:'MARVEL COMICS GROUP',month:'NOV',year:1974,expect:{title:'Incredible Hulk',number:'181'}},
];
async function coverPhoto(cover:Cover,index:number){
 const width=1650,height=2500,hue=(index*47)%360;
 const lines=cover.title.map((word,i)=>`<text x="80" y="${360+i*250}" font-size="${cover.title.length>1?230:280}" font-family="Arial Black,Arial" font-weight="900" fill="#fff6c0" stroke="#111" stroke-width="10">${word}</text>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${hue},55%,35%)"/><circle cx="${width*.6}" cy="${height*.65}" r="520" fill="hsl(${(hue+150)%360},60%,45%)"/><rect x="0" y="0" width="${width}" height="90" fill="#111"/><text x="40" y="65" font-size="52" font-family="Arial" font-weight="700" fill="#fff">${cover.publisher}</text><rect x="${width-330}" y="110" width="290" height="190" fill="#fff"/><text x="${width-310}" y="185" font-size="64" font-family="Arial" font-weight="700" fill="#000">#${cover.number}</text><text x="${width-310}" y="270" font-size="52" font-family="Arial" fill="#000">${cover.month} ${cover.year}</text>${lines}</svg>`;
 // Hand-held photo: slight rotation, blur, JPEG.
 return sharp(await sharp(Buffer.from(svg)).rotate(index%2?2.5:-2,{background:'#222'}).blur(.8).jpeg({quality:70}).toBuffer()).rotate().toBuffer();
}
/** Same views and preprocessing as lib/cover-ocr-client.ts, done with sharp. */
const views:{region:OcrRegion;x:number;y:number;w:number;h:number;width:number}[]=[
 {region:'masthead',x:0,y:0,w:1,h:.38,width:1600},{region:'corner',x:0,y:0,w:.34,h:.22,width:900},{region:'corner',x:.66,y:0,w:.34,h:.22,width:900},{region:'full',x:0,y:0,w:1,h:1,width:1400},
];
let worker:Worker;
before(async()=>{
 const langPath=path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')),'4.0.0_best_int');
 worker=await createWorker('eng',1,{langPath,cachePath:mkdtempSync(path.join(tmpdir(),'ocr-')),gzip:true});
 await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1',user_defined_dpi:'300'});
});
after(async()=>{await worker?.terminate()});

test('free OCR path finds the right series as the top candidate on >= 75% of barcode-less cover photos',async()=>{
 let titleOk=0,numberOk=0,top1=0,titleTop1=0;
 for(const [index,cover] of covers.entries()){
  const photo=await coverPhoto(cover,index),meta=await sharp(photo).metadata(),W=meta.width!,H=meta.height!;const lines:OcrLine[]=[];
  for(const view of views){
   const region={left:Math.round(view.x*W),top:Math.round(view.y*H),width:Math.round(view.w*W),height:Math.round(view.h*H)};
   const png=await sharp(photo).extract(region).resize({width:view.width}).greyscale().normalise({lower:2,upper:98}).png().toBuffer();
   await worker.setParameters({tessedit_pageseg_mode:view.region==='corner'?PSM.AUTO:PSM.SPARSE_TEXT});
   const {data}=await worker.recognize(png,{},{text:true,blocks:true});
   for(const block of data.blocks||[])for(const paragraph of block.paragraphs)for(const line of paragraph.lines)lines.push({text:line.text,confidence:line.confidence,height:line.bbox.y1-line.bbox.y0,region:view.region});
  }
  if(process.env.OCR_DEBUG)console.log('LINES',JSON.stringify(lines.filter(l=>l.region==='corner').map(l=>[l.text,Math.round(l.confidence)])));
  const hints=extractComicHints(lines),ranked=rankCatalogCandidates(hints,catalog);
  const first=ranked[0]?.issue;
  if(hints.titles.some(title=>title.replace(/\s/g,'').includes(cover.expect.title.toLowerCase().replace(/[^a-z]/g,''))))titleOk++;
  if(hints.number===cover.expect.number)numberOk++;
  if(first&&first.title===cover.expect.title)titleTop1++;
  if(first&&first.title===cover.expect.title&&first.number===cover.expect.number)top1++;
  console.log(cover.expect.title,'#'+cover.expect.number,'->',JSON.stringify({titles:hints.titles,number:hints.number,publisher:hints.publisher,year:hints.year}),'top:',first?first.title+' #'+first.number:'none');
 }
 console.log(`OCR fixtures: exact title words ${titleOk}/${covers.length}, issue number read ${numberOk}/${covers.length}, top candidate = right series ${titleTop1}/${covers.length}, right series+issue ${top1}/${covers.length} (starter catalog has few issues per series)`);
 assert.ok(titleTop1/covers.length>=.75,`series top-1 ${titleTop1}/${covers.length}`);
});
