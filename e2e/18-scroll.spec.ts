// No stuck scrolling after opening and closing every kind of dialog/sheet, then main pages scroll to the bottom.
import {test,expect,open,signedInAs,isPhone} from './fixtures';
import {ACCOUNTS} from './accounts';
import type {Page} from '@playwright/test';

async function scrollsToBottom(page:Page){
 expect(await page.evaluate(()=>document.body.style.overflow),'page not locked').not.toBe('hidden');
 const before=await page.evaluate(()=>window.scrollY);
 await page.mouse.move(200,400);await page.mouse.wheel(0,4000);
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before);
}

test.describe('Scrolling',()=>{
 signedInAs('buyer');
 test('after opening and closing each dialog and sheet the page still scrolls',async({page})=>{
  await open(page,'/@'+ACCOUNTS.buyer.handle);
  // Share window.
  await page.locator('.pp-round-share').click();
  await expect(page.getByRole('dialog',{name:'Share your profile'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Share your profile'})).toBeHidden();
  await scrollsToBottom(page);
  // A Directory picker sheet.
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.getByRole('region',{name:/^Favorite comic$/}).getByRole('button').first().click();
  await expect(page.getByRole('dialog',{name:'Favorite comic'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Favorite comic'})).toBeHidden();
  await scrollsToBottom(page);
  // Notifications.
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.getByRole('button',{name:/^Notifications/}).first().click();
  await expect(page.getByRole('dialog',{name:'Notifications'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Notifications'})).toBeHidden();
  await scrollsToBottom(page);
  // Account panel (desktop header).
  if(!isPhone(page)){
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.getByRole('button',{name:'Open your account'}).click();
   await expect(page.getByRole('dialog',{name:'Your account'})).toBeVisible();
   await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Your account'})).toBeHidden();
   await scrollsToBottom(page);
  }
  // Main pages scroll to the bottom.
  for(const path of ['/','/?section=Directory','/?section=Marketplace']){await open(page,path);await scrollsToBottom(page)}
 });
});
