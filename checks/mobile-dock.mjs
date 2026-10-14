// Actual React tree/callback and CSS contracts; no rendered viewport/browser claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReporter, loadTypeScriptModule} from '../architecture/postgres/tests/runtime.mjs';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';

const {default:MobileDock} = loadTypeScriptModule('app/mobile-dock.tsx');
const navigation = loadTypeScriptModule('lib/section-navigation.ts'), report = createReporter('Center Scan mobile dock');
const children = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(children)
  : [node,...children(node.props?.children)];
const expected = ['Home','Directory','Marketplace','Scan a comic','My Profile','Comic Workshop','Upcoming'];
const fixture = (tab='Home', scanOpen=false) => {
  const events=[],tree=MobileDock({tab,scanOpen,onNavigate:value=>events.push({navigate:value}),onScan:()=>events.push({scan:true})});
  const buttons=children(tree).filter(node=>node.type==='button'); return {events,tree,buttons};
};
await report.test('One semantic dock places Scan in the center and retains exactly six section destinations',async()=>{
  const {tree,buttons}=fixture(); assert.equal(tree.type,'nav'); assert.equal(buttons.length,7);
  assert.deepEqual(buttons.map(node=>node.props['aria-label']),expected);
  assert.equal(buttons[3].props['aria-haspopup'],'dialog'); assert.equal(buttons[3].props.type,'button');
  assert.equal(navigation.mobileNavigation.length,6); assert.equal(new Set(navigation.mobileNavigation).size,6);
  assert.equal(navigation.resolveSection('Scan'),null);
});
await report.test('The center action opens scanning once without changing the section; other buttons retain canonical own-profile intent',async()=>{
  const f=fixture(); f.buttons[3].props.onClick(); assert.deepEqual(f.events,[{scan:true}]);
  for(const button of f.buttons.filter((_,index)=>index!==3))button.props.onClick();
  assert.deepEqual(f.events.slice(1).map(value=>value.navigate),['Home','Directory','Marketplace','My Profile','Pressing','Upcoming']);
});
await report.test('Active page and scanner expanded state are exposed independently',async()=>{
  const f=fixture('Marketplace',true); assert.equal(f.buttons[2].props['aria-current'],'page');
  assert.equal(f.buttons.filter(node=>node.props['aria-current']==='page').length,1);
  assert.equal(f.buttons[3].props['aria-expanded'],true); assert.equal(f.buttons[3].props['aria-current'],undefined);
});
await report.test('Server markup emits one nav/Scan control and narrow-screen source preserves touch/safe-area contracts',async()=>{
  const html=renderToStaticMarkup(React.createElement(MobileDock,{tab:'Home',scanOpen:false,onNavigate(){},onScan(){}}));
  assert.equal((html.match(/<nav\b/g)||[]).length,1); assert.equal((html.match(/aria-label="Scan a comic"/g)||[]).length,1);
  const css=readFileSync('app/mobile-dock.css','utf8'); assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/min-width:44px/); assert.match(css,/max-width:359px/); assert.match(css,/focus-visible/);
  assert.equal(css.includes('overflow:hidden'),false);
});
report.finish({browserViewport:'NOT EXECUTED',physicalDevice:'NOT EXECUTED'});
