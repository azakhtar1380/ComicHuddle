// The profile's Collection tab is the only collection: old links redirect there, "Add comics" adds several in
// one save, and visitors see it per "Show my collection" (Everyone / Keys only / Only me). Value is never public.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';
import {addComicToCollection} from './helpers';
import type {Browser,Page} from '@playwright/test';

const collectionTab=(page:Page)=>page.getByRole('tab',{name:'Collection'});
async function guestCollection(browser:Browser){
 const guest=await browser.newContext({storageState:{cookies:[],origins:[]}}),page=await guest.newPage();
 await open(page,'/@'+ACCOUNTS.seller.handle);
 return {page,close:()=>guest.close()};
}

test.describe('Collection tab',()=>{
 signedInAs('seller');
 test('the old Collection page link opens My Profile → Collection (For trade keeps its chip)',async({page})=>{
  await open(page,'/');await addComicToCollection(page);
  await open(page,'/?section=Collection&tab=trade');
  await expect(page).toHaveURL(/section=My(%20|\+)Profile&ptab=collection&chip=trade/);
  await expect(collectionTab(page)).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('toolbar',{name:'Filter comics'}).getByRole('button',{name:'For trade'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:/^Collection$|My collection/})).toHaveCount(0);
 });

 test('Add comics: pick 3 from the Directory and add them in one save',async({page})=>{
  await open(page,'/@'+ACCOUNTS.seller.handle);
  await collectionTab(page).click();
  const before=(await (await page.request.get('/api/vault')).json())?.books?.length||0;
  let saves=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/vault')saves++});
  await page.getByRole('button',{name:'Add comics'}).first().click();
  await page.getByRole('dialog',{name:'Add comics'}).getByRole('button',{name:/Search the Directory/}).click();
  const sheet=page.getByRole('dialog',{name:'Search the Directory'});
  for(let i=0;i<3;i++){
   await sheet.getByRole('combobox').first().fill('Planet Comics');
   const option=page.getByRole('listbox',{name:/matching comic/i}).getByRole('option').nth(i);
   await expect(option).toBeVisible();await option.click();
  }
  await expect(sheet.getByRole('list',{name:'Condition for each comic'}).getByRole('listitem')).toHaveCount(3);
  await sheet.getByRole('button',{name:'Add 3 comics'}).click();
  await expect(page.getByText('Added 3 comics')).toBeVisible();
  expect(saves,'one vault save').toBe(1);
  const after=(await (await page.request.get('/api/vault')).json()).books.length;
  expect(after).toBe(before+3);
 });

 test('visitors see Everyone / Keys only / Only me, and never the value',async({page,browser})=>{
  await open(page,'/');await addComicToCollection(page);                 // Hulk #181 is a key
  await open(page,'/@'+ACCOUNTS.seller.handle);await collectionTab(page).click();
  await expect(page.getByRole('button',{name:'Est. value: tap to show (only you)'})).toBeVisible();
  for(const [label,check] of [
   ['Everyone',async(g:Page)=>{await expect(g.locator('.ct-card').first()).toBeVisible();await expect(g.getByRole('heading',{level:2,name:/comics?$/})).toBeVisible()}],
   ['Keys only',async(g:Page)=>{await expect(g.getByText(/keys only/)).toBeVisible();await expect(g.locator('.ct-key').first()).toBeVisible()}],
   ['Only me',async(g:Page)=>{await expect(g.getByText('This collector keeps their collection private.')).toBeVisible()}],
  ] as const){
   // The dev server may reload this page when the guest's page compiles: reopen it each round.
   await open(page,'/@'+ACCOUNTS.seller.handle);await collectionTab(page).click();
   const option=page.locator('.ct-vis label',{hasText:new RegExp('^'+label+'$')});
   if(!(await option.getAttribute('class'))?.includes('is-on')){
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/profile-extras')&&r.request().method()==='POST');
    await option.click();expect((await saved).ok()).toBe(true);
   }
   const guest=await guestCollection(browser);
   await collectionTab(guest.page).click();await check(guest.page);
   const body=await guest.page.locator('main').innerText();
   expect(body).not.toMatch(/Est\. value|\$\s?\d/);
   await guest.close();
  }
  const api=await page.request.get('/api/profile-collection?handle='+ACCOUNTS.seller.handle);
  expect(JSON.stringify(await api.json())).not.toMatch(/purchase|price|"notes"|certificationNumber|photoId|estimate/i);
  await open(page,'/@'+ACCOUNTS.seller.handle);await collectionTab(page).click();await page.locator('.ct-vis label',{hasText:/^Keys only$/}).click();
 });
});
