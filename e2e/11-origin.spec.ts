// Origin story nudge: one 'system' notification, the ORIGIN STORY #1 setup page, and the snooze.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';

test.describe('Origin story',()=>{
 signedInAs('admin');
 test('the nudge is sent once and the setup page shows the five panels',async({page})=>{
  await open(page,'/');
  const origin=new URL(page.url()).origin;
  for(let i=0;i<2;i++)expect((await page.request.post('/api/trophies',{headers:{Origin:origin},data:{action:'refresh'}})).ok()).toBe(true);
  const items=(await (await page.request.get('/api/notifications?limit=100')).json()).items as {kind:string;title:string;href:string}[];
  const nudges=items.filter(n=>n.title==='Your origin story is still blank!');
  expect(nudges.length,'sent once').toBe(1);
  expect(nudges[0].kind).toBe('system');expect(nudges[0].href).toBe('/origin-story');
  await open(page,'/origin-story');
  await expect(page.locator('#os-title')).toHaveText('ORIGIN STORY #1');
  await expect(page.getByText(/Issue #1/)).toBeVisible();
  await expect(page.getByText('1st appearance of @'+ACCOUNTS.admin.handle+'!')).toBeVisible();
  await expect(page.getByText(/of 5 inked/)).toBeVisible();
  for(const step of ['Profile photo','Handle','Cover photo','Favorite character','Grail + world'])await expect(page.getByText(step,{exact:true})).toBeVisible();
  await expect(page.getByText(/Every hero needs an origin story\. \d more panels? and yours is done!/)).toBeVisible();
  await expect(page.getByText('Unlocks the Origin Story trophy')).toBeVisible();
  await expect(page.getByRole('link',{name:'Finish my origin story'})).toHaveAttribute('href','/@'+ACCOUNTS.admin.handle);
  // A reused test database may already be snoozed (the other device size ran first).
  const remind=page.getByRole('button',{name:'Remind me after my next haul'});
  if(await remind.count()){await remind.click();await expect(page.getByText('We’ll remind you after your next haul.')).toBeVisible()}
  await expect(page.getByRole('button',{name:'Snoozed until your next haul'})).toBeDisabled();
 });
});
