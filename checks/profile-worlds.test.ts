// Worlds: one definition file, ten worlds (no DC/Marvel place names), five inks, four frames, six sound effects.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WORLDS,INKS,FRAMES,SFX,lookFrom,lookStyle,DEFAULT_LOOK,worldFor} from '../lib/profile-worlds';
import {extrasInput} from '../lib/profile-extras';

test('worlds, inks, frames and sound effects',()=>{
 assert.deepEqual(WORLDS.map(w=>w.id),['classic','gargoyle','sunrise','newyork','cosmic','sanctum','neon','sunken','bayou','frontier']);
 for(const w of WORLDS){assert.match(w.skyline,/^url\("data:image\/svg\+xml,/);assert.equal(w.sky.length,2);assert.doesNotMatch(w.name+w.blurb,/gotham|metropolis|asgard|wakanda|atlantis|themyscira/i)}
 assert.deepEqual(INKS.map(i=>[i.name,i.a]),[['Golden Age','#c83e30'],['Silver Age','#345a6a'],['Bronze Age','#8a4b16'],['Modern Age','#20201f'],['Noir','#20201f']]);
 assert.equal(INKS.find(i=>i.id==='modern')!.b,'#7fe0d6');
 assert.deepEqual(FRAMES.map(f=>f.id),['circle','burst','panel','slab']);
 assert.deepEqual([...SFX],['POW!','ZAP!','KA-BOOM!','WHAM!','KRAK!','FWOOSH!']);
 assert.deepEqual(DEFAULT_LOOK,{world:'classic',ink:'golden',frame:'circle',sfx:'POW!'},'default is Classic with the thin ring');
 assert.deepEqual(lookFrom({world:'evil',ink:'noir',frame:'burst',sfx:'ZAP!'}),{world:'classic',ink:'noir',frame:'burst',sfx:'ZAP!'},'unknown values fall back');
 assert.equal(worldFor('nope').id,'classic');
 assert.match(lookStyle({...DEFAULT_LOOK,world:'neon'})['--pp-sky'],/linear-gradient/);
 assert.equal(extrasInput.safeParse({world:'gotham'}).success,false);
 assert.equal(extrasInput.safeParse({world:'gargoyle',ink:'silver',frame:'panel',sfx:'KRAK!'}).success,true);
});
