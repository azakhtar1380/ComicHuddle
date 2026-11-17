// Display name and @handle changes: 2 each for regular members (the first setup doesn't count), staff words
// blocked, old handles held for 30 days and redirected for 90; admins can reset counts. Never trusts the client.
import {test,expect,open} from './fixtures';
import {ACCOUNTS,authFile} from './accounts';
import type {APIRequestContext,Browser} from '@playwright/test';

const seller=ACCOUNTS.seller;
async function as(browser:Browser,role:'seller'|'buyer'|'admin'){
 const context=await browser.newContext({storageState:authFile(role)}),page=await context.newPage();
 await open(page,'/');return {page,request:page.request,origin:new URL(page.url()).origin,close:()=>context.close()};
}
const save=(r:APIRequestContext,origin:string,patch:{name?:string;handle?:string})=>r.post('/api/social',{headers:{Origin:origin},data:{action:'profile',handle:seller.handle,name:seller.name,bio:'Automated test account.',tagline:'',location:'Minneapolis, MN',favorite:'',since:2015,color:seller.color,featured:[],visible:true,dmOpen:true,accept:true,...patch}});
const left=async(r:APIRequestContext)=>(await (await r.get('/api/profile-names')).json()) as {name:number|null;handle:number|null};

test('name and handle changes are limited, reserved words blocked, old handles held and redirected',async({browser})=>{
 test.setTimeout(240_000);
 const admin=await as(browser,'admin'),s=await as(browser,'seller'),b=await as(browser,'buyer');
 const reset=()=>admin.request.post('/api/admin/names',{headers:{Origin:admin.origin},data:{action:'reset',handle:seller.handle}});
 try{
  expect((await reset()).ok()).toBe(true);
  expect(await left(s.request)).toMatchObject({name:2,handle:2});
  // Staff words and look-alikes are refused, and refusals don't use a change.
  for(const name of ['Founder Steve','ComicHuddle Support','Adm1n Ann'])expect((await save(s.request,s.origin,{name})).status(),name).toBe(400);
  expect((await save(s.request,s.origin,{handle:'official_seller'})).status()).toBe(400);
  expect(await left(s.request)).toMatchObject({name:2,handle:2});
  // Two name changes, then locked.
  expect((await save(s.request,s.origin,{name:'QA Seller Two'})).ok()).toBe(true);
  expect((await left(s.request)).name).toBe(1);
  expect((await save(s.request,s.origin,{name:seller.name})).ok()).toBe(true);
  expect((await left(s.request)).name).toBe(0);
  expect((await save(s.request,s.origin,{name:'QA Seller Three'})).status()).toBe(403);
  // A handle change: the old handle redirects and is held for this member only.
  const next=seller.handle+'_x';
  expect((await save(s.request,s.origin,{handle:next})).ok()).toBe(true);
  const moved=await b.request.get('/@'+seller.handle,{maxRedirects:0});
  expect(moved.status()).toBe(308);expect(moved.headers().location).toContain('/@'+next);
  const grab=await b.request.post('/api/social',{headers:{Origin:b.origin},data:{action:'profile',handle:seller.handle,name:ACCOUNTS.buyer.name,bio:'Automated test account.',tagline:'',location:'Minneapolis, MN',favorite:'',since:2015,color:ACCOUNTS.buyer.color,featured:[],visible:true,dmOpen:true,accept:true}});
  expect(grab.status(),'held for 30 days').toBe(409);
  expect((await save(s.request,s.origin,{handle:seller.handle})).ok(),'the member can take it back').toBe(true);
  // The form shows what's left and locks at 0.
  await open(s.page,'/@'+seller.handle);
  await s.page.getByRole('button',{name:'More profile options'}).click();await s.page.getByRole('menuitem',{name:'Edit profile'}).click();
  const form=s.page.getByRole('dialog').filter({has:s.page.getByRole('button',{name:/Save showcase/})});
  await expect(form.getByText('No changes left — contact support').first()).toBeVisible();
  await expect(form.locator('input[name="name"]')).toHaveAttribute('readonly','');
 }finally{
  await reset();
  await Promise.all([admin.close(),s.close(),b.close()]);
 }
});
