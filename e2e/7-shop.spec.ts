// My Collection as your comic shop, and what visitors see on the profile's Collection tab for each
// Shop window setting. The collection's value is never public.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';
import {addComicToCollection,pickComic} from './helpers';
import type {Browser,Page} from '@playwright/test';

async function guestCollectionTab(browser:Browser){
 const guest=await browser.newContext({storageState:{cookies:[],origins:[]}});const page=await guest.newPage();
 await open(page,'/@'+ACCOUNTS.seller.handle);
 await page.getByRole('tab',{name:'Collection'}).click();
 return {page,close:()=>guest.close()};
}
async function openShop(page:Page){
 await open(page,'/?section=Collection');
 await expect(page.getByRole('heading',{name:ACCOUNTS.seller.name+'’s Comics'})).toBeVisible();
}

test.describe('Comic shop',()=>{
 signedInAs('seller');
 test('the shop front shows the sign, sections, glass case and a hidden register',async({page})=>{
  await open(page,'/');
  await addComicToCollection(page);
  await openShop(page);
  await expect(page.getByText('PRIVATE · STAFF ONLY')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Shop sections'}).getByRole('link')).toHaveText(['New arrivals','Glass case','Trade bin','Runs wall','Back issues']);
  await expect(page.getByRole('list',{name:'Recently added comics'}).getByText('NEW').first()).toBeVisible();
  const glass=page.locator('section',{has:page.getByRole('heading',{name:'The glass case'})});
  await expect(glass.getByText(/Incredible Hulk #181/).first()).toBeVisible();
  await expect(glass.getByText('KEY').or(glass.getByText('1ST')).first()).toBeVisible();
  await expect(page.getByText('$ • • • •')).toBeVisible();
  await page.getByRole('button',{name:/Tap to open the till/}).click();
  await expect(page.getByText(/estimated for|No value estimates yet/)).toBeVisible();
  // Stock comics menu, and the list views behind the shop.
  await page.getByRole('button',{name:'Stock comics'}).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Scan','From Directory','Import list']);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'See all'}).click();
  await expect(page.getByRole('tab',{name:/Collection/})).toBeVisible();
  await expect(page.getByRole('button',{name:'Grid view'})).toBeVisible();
  await page.getByRole('button',{name:'Back to the shop'}).click();
  await expect(page.getByRole('heading',{name:ACCOUNTS.seller.name+'’s Comics'})).toBeVisible();
 });

 test('Shop window: Open, Window display and Closed as a guest sees them; value never public',async({page,browser})=>{
  await open(page,'/');await addComicToCollection(page);
  for(const [label,check] of [
   ['Open shop',async(g:Page)=>{await expect(g.getByRole('heading',{name:'In stock'})).toBeVisible();await expect(g.getByText(/Incredible Hulk #181/).first()).toBeVisible()}],
   ['Window display',async(g:Page)=>{await expect(g.getByRole('heading',{name:'The glass case'})).toBeVisible();await expect(g.getByRole('heading',{name:'In stock'})).toHaveCount(0)}],
   ['Closed',async(g:Page)=>{await expect(g.getByText('This collector keeps their collection private.')).toBeVisible()}],
  ] as const){
   await openShop(page);
   const option=page.getByRole('radio',{name:new RegExp('^'+label)});
   if(!(await option.isChecked())){const saved=page.waitForResponse(r=>r.url().endsWith('/api/profile-extras')&&r.request().method()==='POST');await option.check();expect((await saved).ok()).toBe(true);await expect(option).toBeChecked()}
   const guest=await guestCollectionTab(browser);
   await check(guest.page);
   const body=await guest.page.locator('main').innerText();
   expect(body,'no dollar amounts on the public profile').not.toMatch(/\$\s?\d/);
   await guest.close();
  }
  const api=await page.request.get('/api/collection-shop?handle='+ACCOUNTS.seller.handle);
  expect(JSON.stringify(await api.json())).not.toMatch(/purchase|price|"notes"|certificationNumber|photoId|value/i);
  // Leave the default for other tests.
  await openShop(page);await page.getByRole('radio',{name:/^Window display/}).check();
 });

 test('a run tracks owned and missing issues from the collection',async({page})=>{
  await open(page,'/');await addComicToCollection(page);
  await openShop(page);
  await page.getByRole('button',{name:'New run'}).click();
  const dialog=page.getByRole('dialog',{name:'New run'});
  await pickComic(page,dialog,'Planet Comics');
  await dialog.getByLabel('From #').fill('12');await dialog.getByLabel('To #').fill('14');
  await dialog.getByRole('button',{name:'Add to the wall'}).click();
  await expect(page.getByText('Run added to your wall.')).toBeVisible();
  const run=page.locator('.sf-run').last();
  await expect(run.getByRole('progressbar')).toHaveAttribute('aria-valuemax','3');
  await expect(run.getByText(/Missing #/)).toBeVisible();
  await run.getByRole('button',{name:/Delete run/}).click();
  await expect(page.locator('.sf-run')).toHaveCount(0);
 });
});
