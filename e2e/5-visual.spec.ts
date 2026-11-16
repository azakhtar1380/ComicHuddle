// Screenshot comparison: key pages at desktop and phone size are compared with approved screenshots in
// e2e/__screenshots__. A layout change (hidden photo, misplaced box, broken spacing) fails the run.
// After an intended design change: npx playwright test e2e/5-visual.spec.ts --update-snapshots, then look at the
// new images before committing them.
import {test,expect,open,signedInAs} from './fixtures';
import type {Page} from '@playwright/test';

// The dev server's own badge and moving parts (spinners, carousels, timers) are hidden so images are stable.
const STABLE=`nextjs-portal,[data-nextjs-toast],.cover-loading{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
async function shot(page:Page,path:string,name:string,options:{fullPage?:boolean;mask?:string[]}={}){
 await open(page,path);
 await page.addStyleTag({content:STABLE});
 await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0)});
 // Let lazy images below the fold load for full-page shots.
 if(options.fullPage){await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}window.scrollTo(0,0)});await page.waitForLoadState('networkidle').catch(()=>undefined)}
 await expect(page).toHaveScreenshot(name+'.png',{fullPage:options.fullPage??false,mask:(options.mask||[]).map(selector=>page.locator(selector))});
}

test.describe('screenshots: guest',()=>{
 test('home',async({page})=>shot(page,'/','home',{fullPage:true,mask:['.home-covers','.home-chars']}));
 test('marketplace',async({page})=>shot(page,'/?section=Marketplace','marketplace',{mask:['.mpx-card-meta']}));
 test('about',async({page})=>shot(page,'/about','about',{fullPage:true}));
 test('contact',async({page})=>shot(page,'/contact','contact',{fullPage:true}));
 test('sign in',async({page})=>shot(page,'/sign-in?mode=register','sign-in'));
 test('cart (empty)',async({page})=>shot(page,'/cart','cart-empty'));
 test('directory',async({page})=>shot(page,'/?section=Directory','directory',{mask:['.sd-card']}));
});
test.describe('screenshots: signed in',()=>{
 signedInAs('seller');
 test('wallet',async({page})=>shot(page,'/?section=Wallet','wallet'));
 test('sell a comic form',async({page})=>{
  await open(page,'/?section=Marketplace');
  await page.getByRole('button',{name:/sell a comic/i}).first().click();
  await expect(page.getByRole('dialog',{name:/sell a comic/i})).toBeVisible();
  await page.addStyleTag({content:STABLE});
  await expect(page).toHaveScreenshot('sell-form.png');
 });
});
