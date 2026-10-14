// Only the generic offline screen and brand icon are cached. Account data and prices stay online.
const CACHE='comichuddle-shell-v3';
const SHELL=['/offline.html','/icons/comichuddle-hero-192.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('comichuddle-shell-')&&k!==CACHE).map(k=>caches.delete(k)))))});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||event.request.mode!=='navigate'||/^\/(api|signin-with-chatgpt|signout-with-chatgpt|oauth|auth)(\/|\?|$)/.test(url.pathname))return;
 event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html').then(response=>response||new Response('Reconnect to use ComicHuddle.',{status:503,headers:{'Content-Type':'text/plain'}}))));
});
