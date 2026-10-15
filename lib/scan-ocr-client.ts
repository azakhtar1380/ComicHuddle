'use client';
import type {Worker as OcrWorker} from 'tesseract.js';
import {extractCoverTextHints,type CoverTextLine} from './scan-text';
export function createComicOcr(){
 let pending:Promise<OcrWorker>|null=null,closed=false;
 async function worker(){
  if(closed)throw Error('OCR cancelled.');
  if(!pending)pending=import('tesseract.js').then(async({createWorker,PSM})=>{
   const instance=await createWorker('eng',1,{workerPath:'/ocr-runtime/worker.min.js',corePath:'/ocr-runtime/core',langPath:'/ocr-runtime/lang',workerBlobURL:false});
   if(closed){await instance.terminate();throw Error('OCR cancelled.');}
   await instance.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1',user_defined_dpi:'300'});return instance;
  }).catch(error=>{pending=null;throw error});
  return pending;
 }
 return {
  async read(canvas:HTMLCanvasElement){
   const engine=await worker();if(closed)throw Error('OCR cancelled.');
   const {data}=await engine.recognize(canvas,{rotateAuto:true},{text:true,blocks:true});
   const lines:CoverTextLine[]=(data.blocks||[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.map(line=>({text:line.text,confidence:line.confidence,height:line.bbox.y1-line.bbox.y0}))));
   return extractCoverTextHints(data.text,lines);
  },
  close(){closed=true;const current=pending;pending=null;void current?.then(instance=>instance.terminate()).catch(()=>undefined)}
 };
}
