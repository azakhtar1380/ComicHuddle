// PREPARED, NOT EXECUTED in this workspace. Approved external Playwright CI only.
// Uses actual staging browser DOM and JPEG decoding; no physical camera assertion.
import {test,expect} from '@playwright/test';
import path from 'node:path';

const baseURL=process.env.COMICHUDDLE_STAGING_URL;
if(!baseURL)throw Error('Set COMICHUDDLE_STAGING_URL to the explicitly approved test environment');
test.use({baseURL,viewport:{width:390,height:844},
  storageState:process.env.COMICHUDDLE_TEST_AUTH_STATE||undefined});
test.beforeEach(async({page})=>{await page.goto('/?view=app');});

test('mobile center Scan is an action amid six destinations',async({page})=>{
  const dock=page.getByRole('navigation',{name:'Quick mobile navigation'});
  await expect(dock.getByRole('button')).toHaveCount(7);
  const labels=await dock.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
  expect(labels).toEqual(['Home','Directory','Marketplace','Scan a comic','My Profile','Comic Workshop','Upcoming']);
  const bounds=await dock.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return {left:rect.left,width:rect.width};}));
  expect(bounds.every(value=>value.width>=44)).toBeTruthy();expect(bounds[2].left).toBeLessThan(bounds[3].left);expect(bounds[3].left).toBeLessThan(bounds[4].left);
});
test('permission rejection has a usable photo fallback',async({page})=>{
  await page.addInitScript(()=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',
    {configurable:true,value:()=>Promise.reject(new DOMException('Controlled denial','NotAllowedError'))});});
  await page.reload();await page.getByRole('button',{name:'Scan a comic',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('permission was not granted');
  await expect(page.locator('.comic-scan input[type=file]')).toHaveCount(1);
});
test('actual cover photo decode finds exact issue and requires explicit confirmation',async({page})=>{
  await page.addInitScript(()=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',
    {configurable:true,value:()=>Promise.reject(new DOMException('Controlled denial','NotAllowedError'))});});
  await page.reload();await page.getByRole('button',{name:'Scan a comic',exact:true}).click();
  await page.locator('.comic-scan input[type=file]').setInputFiles(path.resolve('public/covers/planet-12.jpg'));
  await expect(page.locator('.scan-confirm')).toContainText('Planet Comics #12');
  await expect(page.locator('.scan-confirm')).toContainText('1941');
  await expect(page.getByRole('button',{name:'Confirm & add',exact:true})).toBeVisible();
  await expect(page.locator('.scan-confirm')).toContainText('does not determine grade');
});
test('compact Directory card opens exact full issue details and its actions',async({page})=>{
  await page.getByRole('navigation',{name:'Quick mobile navigation'}).getByRole('button',{name:'Directory',exact:true}).click();
  const response=await page.request.get('/api/catalog?limit=12&offset=0&sort=featured');expect(response.ok()).toBeTruthy();
  const result=await response.json(),issue=result.issues[0];expect(issue).toBeTruthy();
  const card=page.locator('.shared-directory .sd-card').first();
  await expect(card).toHaveAccessibleName('More info about '+issue.title+' #'+issue.number+' · '+issue.publisher);
  await expect(card.locator('.sd-title')).toHaveText(issue.title+' #'+issue.number);
  await expect(card.locator('.sd-publisher')).toHaveText(issue.publisher);await expect(card.locator('.sd-more')).toContainText('More info');
  await expect(card.locator('button,a,input,select,form,dialog')).toHaveCount(0);
  await expect(card).not.toContainText(/Add to Collection|Raw FMV|CGC 9\.8 FMV|Record source|GoCollect/);
  const image=card.locator('.sd-art>img');if(await image.count())await expect(image).toHaveCSS('object-fit','contain');
  await card.click();const details=page.getByRole('dialog',{name:'Issue details',exact:true});
  const product=details.locator('.ch-product-card');await expect(product).toContainText(issue.title);await expect(product).toContainText(issue.variant);
  await expect(product.getByRole('button',{name:'Raw FMV',exact:true})).toHaveAttribute('aria-pressed','true');
  await product.getByRole('button',{name:'CGC 9.8 FMV',exact:true}).click();
  await expect(product.getByRole('button',{name:'CGC 9.8 FMV',exact:true})).toHaveAttribute('aria-pressed','true');
  const buy=product.getByRole('link',{name:'Find exact copies of '+issue.title+' #'+issue.number,exact:true});
  expect(new URL(await buy.getAttribute('href'),baseURL).searchParams.get('issue')).toBe(String(issue.id));
  await expect(product.getByRole('button',{name:/Add to Collection|Add another copy/})).toBeVisible();
  await expect(details.getByRole('link',{name:'Bibliographic reference',exact:false})).toBeVisible();
});
for(const width of [320,360,390,430,760])test(width+'px Directory renders two portrait cards for Grid and saved List',async({page})=>{
  await page.setViewportSize({width:1200,height:1000});
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Directory/}).click();
  await expect(page.locator('.shared-directory .sd-card').nth(1)).toBeVisible();
  for(const view of ['Grid view','List view']){
    await page.setViewportSize({width:900,height:1000});
    await page.getByRole('button',{name:view,exact:true}).click();
    await page.setViewportSize({width,height:1000});
    await expect(page.locator('.sd-view-toggle')).toBeHidden();
    const geometry=await page.locator('.shared-directory .sd-card').evaluateAll(cards=>cards.slice(0,3).map(card=>{
      const rect=card.getBoundingClientRect(),art=card.querySelector('.sd-art').getBoundingClientRect();
      const image=card.querySelector('.sd-art>img'),cover=image?.getBoundingClientRect();
      const title=card.querySelector('.sd-title'),number=title.querySelector('span');
      return {left:rect.left,right:rect.right,top:rect.top,width:rect.width,artWidth:art.width,artHeight:art.height,
        titleWrap:getComputedStyle(title).overflowWrap,numberSpace:getComputedStyle(number).whiteSpace,
        image:image?{left:cover.left,right:cover.right,top:cover.top,bottom:cover.bottom,fit:getComputedStyle(image).objectFit}:null,
        art:{left:art.left,right:art.right,top:art.top,bottom:art.bottom}};
    }));
    expect(geometry.length).toBeGreaterThanOrEqual(2);expect(Math.abs(geometry[0].top-geometry[1].top)).toBeLessThan(1);
    expect(geometry[1].left-geometry[0].right).toBeCloseTo(12,0);
    if(geometry.length>2)expect(geometry[2].top).toBeGreaterThan(geometry[0].top);
    for(const card of geometry){
      expect(card.left).toBeGreaterThanOrEqual(0);expect(card.right).toBeLessThanOrEqual(width);
      expect(card.artWidth/card.artHeight).toBeCloseTo(.75,2);expect(card.artWidth).toBeLessThanOrEqual(210.1);expect(card.artHeight).toBeLessThanOrEqual(280.1);
      expect(card.titleWrap).toBe('anywhere');expect(card.numberSpace).toBe('normal');
      if(card.image){expect(card.image.fit).toBe('contain');expect(card.image.left).toBeGreaterThanOrEqual(card.art.left);expect(card.image.right).toBeLessThanOrEqual(card.art.right);expect(card.image.top).toBeGreaterThanOrEqual(card.art.top);expect(card.image.bottom).toBeLessThanOrEqual(card.art.bottom);}
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
});
for(const width of [320,375,390])test(width+'px long publisher fixture does not enlarge the root, filter or compact cards',async({page})=>{
  // Controlled API fixture for intrinsic browser sizing, not catalog coverage.
  const publisher='LongUnbrokenPublisherName'.repeat(10);
  const issues=Array.from({length:4},(_,index)=>({id:4000000101+index,gcdId:101+index,
    title:'LongUnbrokenSeriesTitle'.repeat(14),number:'Variant'.repeat(20),publisher,
    year:1998,era:'Modern Age',kind:'Catalog issue',variant:'Standard edition',note:'Controlled layout fixture',
    source:'https://www.comics.org/issue/'+(101+index)+'/'}));
  await page.route('**/api/catalog?*',async route=>{
    const url=new URL(route.request().url());
    const body=url.searchParams.get('browse')==='series'
      ?{series:[],total:0,limit:30,offset:0,hasMore:false}
      :{issues,total:4,limit:12,offset:0,hasMore:false,issueCount:4,scope:'shared',syncedIssueCount:0,
        gcdIssueCount:4,lastSyncedAt:null,lastGcdSyncedAt:null,publishers:[publisher]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.setViewportSize({width,height:1000});await page.reload();
  await page.getByRole('navigation',{name:'Quick mobile navigation'}).getByRole('button',{name:'Directory',exact:true}).click();
  await expect(page.locator('.shared-directory .sd-card')).toHaveCount(4);
  await expect(page.locator('.shared-directory .sd-breadcrumbs')).toHaveCount(0);
  await expect(page.locator('.shared-directory .sd-tree')).toBeHidden();
  await page.getByRole('combobox',{name:'Filter publisher',exact:true}).selectOption(publisher);
  await expect(page.locator('.shared-directory .sd-card')).toHaveCount(4);
  const bounds=await page.locator('.shared-directory .sd-card').evaluateAll(cards=>cards.map(card=>{
    const r=card.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};
  }));
  expect(Math.abs(bounds[0].top-bounds[1].top)).toBeLessThan(1);expect(bounds[2].top).toBeGreaterThan(bounds[0].top);
  for(const rectangle of bounds){expect(rectangle.left).toBeGreaterThanOrEqual(0);expect(rectangle.right).toBeLessThanOrEqual(width);}
  for(const selector of ['.sd-quick-find','.picker-input','.sd-filters','.sd-filters select','.sd-browser-main']){
    const rectangles=await page.locator('.shared-directory '+selector).evaluateAll(elements=>elements.map(element=>{
      const r=element.getBoundingClientRect();return {left:r.left,right:r.right};
    }));
    for(const r of rectangles){expect(r.left).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(width);}
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('raw card save preserves private ownership in authenticated test account',async({page})=>{
  test.skip(!process.env.COMICHUDDLE_TEST_AUTH_STATE||process.env.COMICHUDDLE_TEST_CONFIRM_WRITES!=='true',
    'Requires provisioned test-account session and explicitly enabled staging writes');
  await page.getByRole('navigation',{name:'Quick mobile navigation'}).getByRole('button',{name:'Directory',exact:true}).click();
  await page.locator('.shared-directory .sd-card').first().click();
  const card=page.getByRole('dialog',{name:'Issue details',exact:true}).locator('.ch-product-card');
  await card.getByRole('button',{name:/Add to Collection|Add another copy/}).click();
  const form=page.locator('dialog.ch-collection-dialog[open]');await form.getByLabel('Owner-stated condition').selectOption('FINE');
  await form.getByLabel('Purchase price').fill('12.34');await form.getByLabel('Private ownership notes').fill('STAGING_QA_PRIVATE_NOTE');
  await form.getByRole('button',{name:'Save one copy',exact:true}).click();await expect(card).toContainText('Saved one copy');
  const response=await page.request.get('/api/vault');expect(response.ok()).toBeTruthy();const vault=await response.json();
  const stored=vault.books.find(copy=>copy.ownership?.notes==='STAGING_QA_PRIVATE_NOTE');expect(stored).toBeTruthy();expect(stored.ownership.purchasePriceCents).toBe('1234');
});
