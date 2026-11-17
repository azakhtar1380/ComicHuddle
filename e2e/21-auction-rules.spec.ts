// Auctions, like eBay: once live the seller can't end, cancel or take one down (UI and API); only a note or photos
// can be added; relisting is only for an auction that ended with no bids; an admin can remove one (audited).
import {test,expect,open} from './fixtures';
import {authFile} from './accounts';
import {PHOTO,addComicToCollection} from './helpers';
import {readFileSync} from 'node:fs';
import type {Browser} from '@playwright/test';

async function as(browser:Browser,role:'seller'|'admin'){const context=await browser.newContext({storageState:authFile(role)}),page=await context.newPage();await page.addLocatorHandler(page.getByRole('dialog').filter({hasText:'Trophy unlocked!'}),async overlay=>{await overlay.getByRole('button',{name:'Close'}).click()},{noWaitAfter:true});await open(page,'/');return {page,origin:new URL(page.url()).origin,close:()=>context.close()}}

test('a live auction can’t be ended by the seller; notes and photos only; admin can remove it',async({browser})=>{
 test.setTimeout(240_000);
 const s=await as(browser,'seller'),admin=await as(browser,'admin');
 try{
  await addComicToCollection(s.page);
  const vault=await (await s.page.request.get('/api/vault')).json();
  const listed=new Set(((await (await s.page.request.get('/api/marketplace?offset=0')).json()).listings||[]).flatMap((l:{items:{bookId:string}[]})=>l.items.map(i=>i.bookId)));
  const copy=(vault.books as {id:string;title:string}[]).find(b=>!listed.has(b.id))!;
  const media=await s.page.request.post('/api/media',{headers:{Origin:s.origin,'Content-Type':'image/jpeg'},data:readFileSync(PHOTO)});
  expect(media.ok(),await media.text()).toBe(true);const photo=(await media.json()).id as string;
  const created=await s.page.request.post('/api/social',{headers:{Origin:s.origin},data:{action:'listing',kind:'single',saleType:'auction',bookIds:[copy.id],description:'Auction rules test.',price:1000,shipping:500,photos:[photo],attest:true,usaAttest:true,durationHours:24,fulfillment:'shipping'}});
  expect(created.ok(),await created.text()).toBe(true);const listingId=(await created.json()).listingId as string;
  // API: no take-down while live, no relist while live.
  const down=await s.page.request.post('/api/social',{headers:{Origin:s.origin},data:{action:'withdraw_listing',listingId}});
  expect(down.status()).toBe(409);expect((await down.json()).error).toContain('can’t be ended early');
  expect((await s.page.request.post('/api/social',{headers:{Origin:s.origin},data:{action:'relist_listing',listingId,as:'fixed'}})).status()).toBe(409);
  // Only a note (and photos) can be added.
  const note=await s.page.request.post('/api/social',{headers:{Origin:s.origin},data:{action:'auction_addendum',listingId,note:'Light spine tick, see photo 2.'}});
  expect(note.ok(),await note.text()).toBe(true);
  const after=((await (await s.page.request.get('/api/marketplace?offset=0')).json()).listings as {id:string;description:string;title:string}[]).find(l=>l.id===listingId)!;
  expect(after.description).toMatch(/Added by seller on .+: Light spine tick/);
  // UI: no take-down button, the live-auction rule and "Add photos or a note" instead.
  await open(s.page,'/?section=Marketplace');
  await s.page.locator('.mpx-card',{hasText:after.title}).first().locator('.mpx-card-open').click();
  await expect(s.page.getByText('Your auction is live. It can’t be ended early')).toBeVisible();
  await expect(s.page.getByRole('button',{name:/Take down listing/})).toHaveCount(0);
  await expect(s.page.getByRole('button',{name:'Add photos or a note'})).toBeVisible();
  // Admin removal for a rules violation.
  const removed=await admin.page.request.post('/api/social',{headers:{Origin:admin.origin},data:{action:'cancel_auction',listingId,reason:'Test removal'}});
  expect(removed.ok(),await removed.text()).toBe(true);
  const gone=((await (await s.page.request.get('/api/marketplace?offset=0')).json()).listings as {id:string}[]).some(l=>l.id===listingId);
  expect(gone,'removed auction is no longer listed').toBe(false);
  // A regular member can't remove auctions.
  expect((await s.page.request.post('/api/social',{headers:{Origin:s.origin},data:{action:'cancel_auction',listingId}})).status()).toBe(403);
 }finally{await Promise.all([s.close(),admin.close()])}
});
