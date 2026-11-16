// A collector asks to be verified (pending), an admin turns the check on, and the blue check shows on
// their public profile as "Verified collector".
import {test,expect,open} from './fixtures';
import {ACCOUNTS,authFile} from './accounts';

test('collector verification goes from pending to verified after admin approval',async({browser})=>{
 const buyer=await browser.newContext({storageState:authFile('buyer')}),b=await buyer.newPage();
 await open(b,'/');
 const origin=new URL(b.url()).origin;
 const asked=await b.request.post('/api/verification',{headers:{Origin:origin},data:{action:'request',contact:'email is fine'}});
 expect(asked.ok(),await asked.text()).toBe(true);
 const status=(await asked.json()).status as string;expect(status).toMatch(/pending|verified/);
 const admin=await browser.newContext({storageState:authFile('admin')}),a=await admin.newPage();
 if(status==='pending'){
 await open(a,'/admin');
 const panel=a.locator('#verified-collectors');
 await expect(panel.getByText('@'+ACCOUNTS.buyer.handle)).toBeVisible();
 const row=panel.locator('.vp-row',{hasText:'@'+ACCOUNTS.buyer.handle});
 if(await row.getByRole('button',{name:'Turn on the check'}).count()){
  await row.getByLabel('Note (how you confirmed)').fill('Confirmed by email');
  await row.getByRole('button',{name:'Turn on the check'}).click();
  await expect(row.getByRole('button',{name:'Turn on the check'})).toHaveCount(0);
 }
 }
 const guest=await browser.newContext({storageState:{cookies:[],origins:[]}}),g=await guest.newPage();
 await open(g,'/@'+ACCOUNTS.buyer.handle);
 await expect(g.getByRole('heading',{level:1}).getByRole('img',{name:'Verified collector'})).toBeVisible();
 await expect(g.getByText('Verified collector · How we verify')).toBeVisible();
 for(const c of [buyer,admin,guest])await c.close();
});
