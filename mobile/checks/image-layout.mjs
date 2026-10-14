import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../art-layout.ts',import.meta.url),'utf8');
const script=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const context={exports:{}};vm.runInNewContext(script,context);
const {coverFrame,dockFrame}=context.exports;
const devices=[[320,568],[375,667],[390,844],[430,932],[768,1024],[1024,768],[844,390]];
for(const [width,height] of devices){
 const horizontalInsets=width>height?94:0;
 const dock=dockFrame(width,horizontalInsets);
 assert(dock.width<=width-horizontalInsets,'Navigation exceeds safe content width');
 assert(dock.tabWidth>=44,'A destination touch target is narrower than 44px');
 assert(dock.scanDiameter>=44&&dock.scanDiameter<=56,'Scan target is outside its bounds');
 assert.equal(4+dock.tabWidth*3+dock.scanDiameter/2,dock.width/2,'Scan is off center');
 if(width===320){assert.equal(dock.scanDiameter,48);assert.equal(dock.tabWidth,44);}
 for(const variant of ['grid','hero','thumbnail','detail','swipe']){
  const frame=coverFrame(variant,width,height);
  assert(frame.width>0&&frame.height>0);
  assert(Math.abs(frame.width/frame.height-.74)<.01,'Cover ratio changed');
  assert(frame.height<=251,'Cover expanded beyond the app image limit');
  assert(frame.width<=width-40,'Cover exceeds the content width');
  if(variant==='grid')assert(frame.width<=(Math.min(width,720)-40)*.478-20+1,'Grid cover overflows its card');
  if(variant==='detail')assert(frame.width<=142,'Detail cover grows on tablets');
  if(variant==='thumbnail')assert.equal(frame.width,38,'Issue thumbnail expanded');
 }
 if(height<=640)assert(coverFrame('swipe',width,height).height<=131,'Short-screen swipe cover is oversized');
}
console.log('Cover and centered navigation bounds passed for seven phone, tablet and landscape viewports.');
