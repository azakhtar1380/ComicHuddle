// Founder badge from COMICHUDDLE_FOUNDER_EMAIL (the test server sets it to the admin test account), and no stuck
// scrolling after opening and closing every kind of dialog/sheet.
import {test,expect,open,signedInAs,isPhone} from './fixtures';
import {ACCOUNTS} from './accounts';
import type {Page} from '@playwright/test';

async function scrollsToBottom(page:Page){
 expect(await page.evaluate(()=>document.body.style.overflow),'page not locked').not.toBe('hidden');
 const before=await page.evaluate(()=>window.scrollY);
 await page.mouse.move(200,400);await page.mouse.wheel(0,4000);
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before);
}

test.describe('Founder',()=>{
 test('the founder email shows the Founder badge only (no extra Admin tag)',async({page})=>{
  await open(page,'/@'+ACCOUNTS.admin.handle);
  await expect(page.locator('.pp-founder')).toHaveText(/Founder/);
  await expect(page.locator('.pp-tag-admin')).toHaveCount(0);
  // Other people's pages never get the email, only the flag.
  const body=await (await page.request.get('/api/social?kind=profile&handle='+ACCOUNTS.admin.handle)).text();
  expect(body).not.toContain('e2e-admin@comichuddle.test');
  expect(body).toContain('"founder":true');
 });
});

