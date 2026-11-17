// My Profile: the clean /@handle link and its preview meta, hidden profiles, photo upload with Mr. Huddles,
// the share screen (both cards, five share buttons with fallbacks), and the shared horizontal scroll rows.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';
import {PHOTO,addComicToCollection} from './helpers';
import type {Page,Locator} from '@playwright/test';

const box=async(locator:Locator)=>{const b=await locator.boundingBox();if(!b)throw Error('not visible');return b};
/** Mr. Huddles stands at the photo's bottom-right: to the right of the photo's center, overlapping its right edge, bottoms level. */
async function expectHuddlesBottomRight(photo:Locator,huddles:Locator){
 const p=await box(photo),h=await box(huddles);
 expect(h.x+h.width,'Huddles reaches past the photo’s right edge').toBeGreaterThan(p.x+p.width);
 expect(h.x,'Huddles overlaps the photo’s right edge').toBeLessThan(p.x+p.width);
 expect(h.x,'Huddles is on the right half').toBeGreaterThan(p.x+p.width*.5);
 expect(Math.abs(h.y+h.height-(p.y+p.height)),'Huddles stands at the bottom').toBeLessThan(p.height*.2);
}
async function profileApi(page:Page,patch:Record<string,unknown>,role:keyof typeof ACCOUNTS){
 const a=ACCOUNTS[role];
 // The dev server can drop a connection while it compiles: retry a couple of times.
 for(let attempt=0;;attempt++){try{
 const r=await page.request.post('/api/social',{headers:{Origin:new URL(page.url()).origin},data:{action:'profile',handle:a.handle,name:a.name,bio:'Automated test account.',tagline:'',location:'Minneapolis, MN',favorite:'',since:2015,color:a.color,featured:[],visible:true,dmOpen:true,accept:true,...patch}});
 expect(r.ok(),await r.text()).toBe(true);return;
 }catch(error){if(attempt>=2)throw error;await page.waitForTimeout(1500)}}
}

test.describe('Profile link as a guest',()=>{
 test('/@handle opens the profile with link-preview meta',async({page,request})=>{
  await open(page,'/@'+ACCOUNTS.seller.handle);
  await expect(page.getByRole('heading',{level:1,name:ACCOUNTS.seller.name})).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content',`${ACCOUNTS.seller.name} (@${ACCOUNTS.seller.handle}) on ComicHuddle`);
  const image=await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toContain('/api/og/profile?handle='+ACCOUNTS.seller.handle);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');
  const og=await request.get(new URL(image!).pathname+new URL(image!).search);
  expect(og.status()).toBe(200);expect(og.headers()['content-type']).toContain('image/png');
 });
 test('old ?collector= links redirect to /@handle',async({page})=>{
  await open(page,'/?collector='+ACCOUNTS.seller.handle);
  await expect(page).toHaveURL(new RegExp('/@'+ACCOUNTS.seller.handle+'$'));
 });
 test('unknown profiles return 404 with no preview meta',async({page,request})=>{
  const response=await open(page,'/@no_such_member');
  expect(response?.status()).toBe(404);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  expect((await request.get('/api/og/profile?handle=no_such_member')).status()).toBe(404);
 });
 test('the profile API works for guests on visible profiles only',async({request})=>{
  const ok=await request.get('/api/social?kind=profile&handle='+ACCOUNTS.seller.handle);
  expect(ok.status()).toBe(200);
  const body=await ok.json();expect(body.handle).toBe(ACCOUNTS.seller.handle);
  expect(JSON.stringify(body)).not.toMatch(/"price"|purchase|"value"/i);
 });
});

test.describe('Hidden profiles',()=>{
 signedInAs('admin');
 test('a hidden profile is 404 for other people, and back when visible',async({page,browser})=>{
  await open(page,'/');
  await profileApi(page,{visible:false},'admin');
  try{
   const guest=await browser.newContext({storageState:{cookies:[],origins:[]}});const g=await guest.newPage();
   const response=await g.goto('/@'+ACCOUNTS.admin.handle);
   expect(response?.status()).toBe(404);
   await expect(g.locator('meta[property="og:image"]')).toHaveCount(0);
   expect((await g.request.get('/api/og/profile?handle='+ACCOUNTS.admin.handle)).status()).toBe(404);
   await guest.close();
   // The owner still sees their own page.
   const own=await open(page,'/@'+ACCOUNTS.admin.handle);
   expect(own?.status()).toBe(200);
   await expect(page.getByText('Hidden. Only you can see this profile.')).toBeVisible();
  }finally{await profileApi(page,{visible:true},'admin')}
 });
});

test.describe('My profile',()=>{
 signedInAs('seller');
 test('photo upload replaces the outline; Mr. Huddles stays at the photo’s bottom-right',async({page})=>{
  await open(page,'/@'+ACCOUNTS.seller.handle);
  const wrap=page.locator('.pp-photo-wrap').first(),photo=wrap.locator('.pp-photo');
  await expect(wrap.locator('.pp-huddles')).toHaveAttribute('aria-hidden','true');
  await expectHuddlesBottomRight(photo,wrap.locator('.pp-huddles'));
  await page.getByLabel(/Upload a profile photo|Replace profile photo/).setInputFiles(PHOTO);
  await expect(page.getByText('Profile photo saved.')).toBeVisible();
  await expect(photo.locator('img')).toBeVisible();
  await expect(photo.locator('.pp-photo-empty')).toHaveCount(0);
  await expectHuddlesBottomRight(photo,wrap.locator('.pp-huddles'));
 });
 test('share cards keep Mr. Huddles at the photo’s bottom-right; all five buttons work or fall back',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  // Never reach the real Facebook: the popup is a new page, so route on the whole context.
  await context.route(/facebook.com/,route=>route.fulfill({status:200,contentType:'text/html',body:'<title>share</title>'}));
  await open(page,'/@'+ACCOUNTS.seller.handle);
  await page.getByRole('button',{name:'Share',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Share your profile'});
  for(const style of ['Slab','Trading card']){
   await dialog.getByText(style,{exact:true}).click();
   await expect(dialog.locator('.ps-card')).toHaveAttribute('data-ready','true');
   const card=dialog.locator('.ps-card svg');
   await expect(card).toHaveAttribute('data-card',style==='Slab'?'slab':'trading');
   await expectHuddlesBottomRight(card.locator('[data-role="avatar"]').first(),card.locator('[data-role="huddles"]'));
  }
  await expect(dialog.getByRole('img',{name:/QR code for/})).toBeVisible();
  await expect(dialog.getByText('Scan at the con')).toBeVisible();
  await dialog.getByRole('button',{name:'Copy'}).click();
  await expect(dialog.getByRole('button',{name:'Copied!'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Copy'})).toBeVisible({timeout:4000});
  const buttons=dialog.getByRole('list',{name:'Share to'}).getByRole('button');
  await expect(buttons).toHaveText(['Instagram','Facebook','Messages','Save card','More']);
  const hasShare=await page.evaluate(()=>typeof navigator.share==='function');
  // Instagram: native share sheet with the PNG, or copy-link fallback.
  if(!hasShare){await buttons.nth(0).click();await expect(page.getByText('Instagram sharing isn’t available here, so we copied your link.')).toBeVisible()}
  const [popup]=await Promise.all([page.waitForEvent('popup'),buttons.nth(1).click()]);
  expect(popup.url()).toContain('facebook.com/sharer/sharer.php?u=');await popup.close();
  if(!hasShare){await buttons.nth(2).click();await expect(page.getByText(/Texting isn’t available on this device, so we copied your link\.|copied your link/)).toBeVisible()}
  const [download]=await Promise.all([page.waitForEvent('download'),buttons.nth(3).click()]);
  expect(download.suggestedFilename()).toMatch(/^comichuddle-qa_seller-(slab|trading)\.png$/);
  if(!hasShare){await buttons.nth(4).click();await expect(page.getByText('Sharing isn’t available here, so we copied your link.')).toBeVisible()}
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toMatch(/\/@qa_seller$/);
  await expect(dialog.getByRole('switch',{name:/Collection value/})).toBeDisabled();
  await expect(dialog.getByRole('switch',{name:/Collection value/})).not.toBeChecked();
 });
 test('horizontal rows scroll without a visible scroll bar at rest',async({page})=>{
  await open(page,'/');await addComicToCollection(page);              // the chips show once there is a comic
  await open(page,'/@'+ACCOUNTS.seller.handle);
  await page.getByRole('tab',{name:'Collection'}).click();          // the filter chips are a scroll row
  const row=page.locator('.ch-hscroll').first();
  await expect(row).toBeVisible();
  await page.mouse.move(0,0);
  await expect(row,'at rest (not mid-scroll)').not.toHaveClass(/is-scrolling/);
  const style=await row.evaluate(el=>{const s=getComputedStyle(el),h=el as HTMLElement;return {overflowX:s.overflowX,scrollbarWidth:s.scrollbarWidth,gap:h.offsetHeight-h.clientHeight}});
  expect(style.overflowX).toBe('auto');
  expect(style.scrollbarWidth).toBe('none');
  expect(style.gap,'no scroll bar takes up space at rest').toBe(0);
 });
});
