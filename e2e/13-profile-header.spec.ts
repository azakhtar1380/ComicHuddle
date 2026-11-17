// Profile header: nothing overlaps at 360/390/430 and on desktop; Edit profile (owner) or Message (visitor) on the
// right; all four tabs fit without scrolling; "Get verified" shows on My Profile for the owner only.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';
import type {Locator,Page} from '@playwright/test';

const handle=ACCOUNTS.buyer.handle;
type Box={x:number;y:number;width:number;height:number};
const rect=async(l:Locator):Promise<Box>=>{const b=await l.boundingBox();if(!b)throw Error('not visible');return b};
const overlaps=(a:Box,b:Box)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
async function checkHeader(page:Page,right:string|RegExp){
 const share=page.locator('.pp-round-share'),photo=page.locator('.pp-avatar-row .pp-photo'),huddles=page.locator('.pp-avatar-row .pp-huddles'),side=page.locator('.pp-avatar-row .pp-round').last();
 await expect(side).toContainText(right);
 const boxes={share:await rect(share),photo:await rect(photo),huddles:await rect(huddles),side:await rect(side)};
 for(const [a,b] of [['share','photo'],['share','huddles'],['side','photo'],['side','huddles']] as const)expect(overlaps(boxes[a],boxes[b]),`${a} overlaps ${b}`).toBe(false);
 const card=await rect(page.locator('article.pp'));
 for(const k of ['share','side','photo','huddles'] as const){const b=boxes[k];expect(b.x>=card.x-1&&b.x+b.width<=card.x+card.width+1,k+' is fully inside the profile card').toBe(true)}
 const change=page.locator('.pp-cover-change');
 if(await change.count()){const c=await rect(change);for(const k of ['share','side','photo'] as const)expect(overlaps(c,boxes[k]),'Change cover overlaps '+k).toBe(false)}
 const width=page.viewportSize()!.width;
 expect(await page.evaluate(()=>document.documentElement.scrollWidth),'no sideways page scroll').toBeLessThanOrEqual(width);
 const tabs=page.getByRole('tablist',{name:'Profile sections'});
 expect(await tabs.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'tabs never scroll').toBe(true);
 for(const tab of await tabs.getByRole('tab').all()){
  expect(await tab.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'tab text not cut off: '+await tab.innerText()).toBe(true);
  const t=await rect(tab),list=await rect(tabs);expect(t.x+t.width).toBeLessThanOrEqual(list.x+list.width+1);
  expect(t.height).toBeGreaterThanOrEqual(44);
 }
}

test.describe('Profile header',()=>{
 signedInAs('buyer');
 test('owner: no overlaps at 360/390/430 and desktop; Get verified opens the verification sheet',async({page})=>{
  const sizes=(page.viewportSize()?.width??1280)<700?[360,390,430]:[1280];
  for(const width of sizes){
   await page.setViewportSize({width,height:860});
   await open(page,'/@'+handle);
   await checkHeader(page,'Edit profile');
   await expect(page.getByRole('tab')).toHaveCount(4);
  }
  await page.getByRole('button',{name:/^Edit profile$/}).click();
  await expect(page.getByRole('dialog').filter({has:page.getByRole('button',{name:/Save showcase/})})).toBeVisible();
  await page.keyboard.press('Escape');
  const get=page.getByRole('button',{name:/^Get verified/});
  const pending=page.getByText('Verification pending · we’ll contact you');
  // The test database is shared: 9-verified may already have verified this account.
  const verified=page.getByText('Verified collector · How we verify');
  await expect(get.or(pending).or(verified).first()).toBeVisible();
  if(await verified.count())await expect(get).toHaveCount(0);
  if(await get.count()){
   await expect(page.getByText('Show buyers you’re a real collector.')).toBeVisible();
   await get.click();
   const sheet=page.getByRole('dialog',{name:'Get verified'});
   await expect(sheet.getByRole('link',{name:'How we verify'})).toBeVisible();
   await sheet.getByRole('button',{name:'Cancel'}).click();await expect(sheet).toBeHidden();
  }
 });
 test('visitor: Message on the right, never a Get verified button',async({browser,page})=>{
  const guest=await browser.newContext({storageState:{cookies:[],origins:[]},viewport:page.viewportSize()!}),g=await guest.newPage();
  await open(g,'/@'+ACCOUNTS.seller.handle);
  await checkHeader(g,/Message|No DMs/);
  await expect(g.getByRole('button',{name:/Get verified/})).toHaveCount(0);
  await expect(g.getByText(/Verification pending/)).toHaveCount(0);
  await guest.close();
 });
});
