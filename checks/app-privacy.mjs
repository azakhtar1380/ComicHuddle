// Exercise service-worker boundaries: private records are never persisted for offline use.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const handlers={},stored=[],network=[],removed=[];
const origin='https://comichuddle.test';
let rejectNetwork=false;
const context={URL,Response,Promise,self:{location:{origin},addEventListener:(event,fn)=>{handlers[event]=fn}},caches:{open:async()=>({addAll:async urls=>{stored.push(...urls)}}),keys:async()=>['unrelated-cache','comichuddle-shell-old','comichuddle-shell-v2','comichuddle-shell-v3'],delete:async key=>{removed.push(key);return true},match:async key=>key==='/offline.html'?new Response('Generic offline page'):undefined},fetch:async request=>{network.push(request.url);if(rejectNetwork)throw Error('offline');return new Response('Private page from network')}};
vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
let install;handlers.install({waitUntil:p=>{install=p}});await install;
assert.deepEqual(stored,['/offline.html','/icons/comichuddle-hero-192.png']);
let activate;handlers.activate({waitUntil:p=>{activate=p}});await activate;
assert.deepEqual(removed,['comichuddle-shell-old','comichuddle-shell-v2']);
function dispatch(path,options={}){let result;handlers.fetch({request:{url:new URL(path,origin).href,method:options.method||'GET',mode:options.mode||'navigate'},respondWith:p=>{result=p}});return result}
for(const privatePath of ['/api/vault','/api/social','/api/media/photo','/api/values','/api/pressing','/signin-with-chatgpt','/signout-with-chatgpt','/auth/callback','https://external.test/'])assert.equal(dispatch(privatePath),undefined);
assert.equal(dispatch('/',{method:'POST'}),undefined);
assert.equal(await (await dispatch('/?section=Account')).text(),'Private page from network');
assert.equal(stored.length,2,'Private page must not be added to cache');
rejectNetwork=true;
assert.equal(await (await dispatch('/?section=Messages')).text(),'Generic offline page');
assert.equal(stored.length,2,'Offline fallback must not cache account or value content');
const manifest=JSON.parse(await readFile('public/manifest.webmanifest','utf8'));
assert.equal(manifest.name,'ComicHuddle');assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons)await readFile('public'+icon.src);
console.log('PASS: PWA caches only generic offline assets; APIs/auth bypass worker; account navigation stays uncached; manifest and icons exist.');
