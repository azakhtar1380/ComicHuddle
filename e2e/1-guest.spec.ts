// Signed-out visitors: everything they can browse, and every place that should ask them to sign in.
import {test,expect,open,isPhone} from './fixtures';

test.describe('guest',()=>{
 test('home explains the site and links into every section',async({page})=>{
  await open(page,'/');
  await expect(page.getByRole('heading',{level:1})).toContainText(/comic/i);
  for(const name of [/directory/i,/marketplace/i])await expect(page.getByRole('link',{name}).first()).toBeVisible();
  await expect(page.locator('#support')).toBeVisible();
  await expect(page.locator('#support')).toContainText(/not charitable|aren’t charitable/i);
 });

 test('directory search finds a comic and opens its page',async({page})=>{
  await open(page,'/?section=Directory');
  const search=page.getByRole('combobox',{name:/search the directory/i});
  await search.fill('Spider-Man');await search.press('Enter');
  await page.waitForLoadState('networkidle').catch(()=>undefined);
  await expect(page.getByText(/spider-man/i).first()).toBeVisible();
 });

 test('characters page lists characters',async({page})=>{
  const response=await open(page,'/characters');
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole('heading',{level:1})).toBeVisible();
 });

 test('marketplace can be browsed; buying, selling and bidding ask to sign in',async({page})=>{
  await open(page,'/?section=Marketplace');
  await expect(page.getByText(/sign in to buy, bid|browse freely/i).first()).toBeVisible();
  await page.getByRole('button',{name:/sell a comic/i}).first().click();
  // A sign-in prompt opens instead of the listing form.
  const prompt=page.getByRole('dialog');
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('link',{name:/sign in|log in/i}).first()).toBeVisible();
  await expect(page.getByRole('dialog',{name:/sell a comic/i})).toHaveCount(0);
 });

 test('about and contact pages show the company and how to reach it',async({page})=>{
  await open(page,'/about');
  await expect(page.getByRole('heading',{level:1})).toContainText(/collectors/i);
  await expect(page.getByText(/Metron/).first()).toBeVisible();
  await open(page,'/contact');
  await expect(page.locator('main').getByText('maliktecks@gmail.com').first()).toBeVisible();
  await expect(page.locator('main').getByText(/612.*442.*2871/).first()).toBeVisible();
 });

 test('account areas ask a guest to sign in instead of breaking',async({page})=>{
  for(const path of ['/?section=Account&accountTab=Orders','/wallet','/?section=Collection']){
   await open(page,path);
   await expect(page.getByText(/sign in|log in/i).first(),path).toBeVisible();
  }
 });

 test('admin pages are closed to guests',async({page})=>{
  for(const path of ['/admin','/admin/covers']){
   await open(page,path);
   await expect(page.getByText(/sign in|log in|not available|admins only|not found/i).first(),path).toBeVisible();
   await expect(page.getByText(/audit log|cover review/i)).toHaveCount(0);
  }
 });

 test('sign-up form checks its fields before sending',async({page})=>{
  await open(page,'/sign-in?mode=register');
  await page.locator('#auth-email').fill('not-an-email');
  await page.locator('#auth-password').fill('short');
  await page.locator('form').getByRole('button',{name:/join free/i}).click();
  await expect(page.getByText(/complete email address/i).first()).toBeVisible();
  await expect(page).toHaveURL(/sign-in/);
 });

 test('a new visitor can join and is signed in right away',async({page})=>{
  await open(page,'/sign-in?mode=register');
  await page.locator('#auth-email').fill('e2e-join-'+Date.now()+'@comichuddle.test');
  await page.locator('#auth-password').fill('Join-test-'+Math.random().toString(36).slice(2,12)+'!');
  await page.locator('#auth-name').fill('QA Joiner');
  await page.locator('form').getByRole('button',{name:/join free/i}).click();
  await expect(page.getByText(/check this box/i)).toBeVisible(); // the rules box must be ticked
  await page.locator('#auth-rules').check();
  await page.locator('form').getByRole('button',{name:/join free/i}).click();
  await page.waitForURL(url=>!url.pathname.startsWith('/sign-in'),{timeout:30_000});
  const session=await page.request.get('/api/auth/get-session');expect((await session.json())?.user?.name).toBe('QA Joiner');
 });

 test('phone shows the bottom bar; desktop shows the header sections',async({page})=>{
  await open(page,'/');
  if(isPhone(page))await expect(page.getByRole('link',{name:/market/i}).last()).toBeVisible();
  else await expect(page.getByRole('link',{name:/about us/i}).first()).toBeVisible();
 });

 test('an unknown page shows a friendly not-found page',async({page})=>{
  const response=await open(page,'/this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('link',{name:/home|back/i}).first()).toBeVisible();
 });
});
