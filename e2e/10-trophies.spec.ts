// Trophies: a tier unlock creates a notification and shows the unlock screen once; the trophy case page works.
import {test,expect,open,signedInAs} from './fixtures';
import {addComicToCollection} from './helpers';

test.describe('Trophies',()=>{
 signedInAs('buyer');
 test('an unlock creates a notification and shows the unlock screen once',async({page})=>{
  await page.removeLocatorHandler(page.getByRole('dialog').filter({hasText:'Trophy unlocked!'})); // this test checks the screen itself
  await open(page,'/');
  await addComicToCollection(page);                       // a Directory-linked comic: First Appearance
  const refreshed=await page.request.post('/api/trophies',{headers:{Origin:new URL(page.url()).origin},data:{action:'refresh'}});
  expect(refreshed.ok()).toBe(true);
  const notes=await (await page.request.get('/api/notifications?limit=50')).json();
  expect(notes.items.some((n:{kind:string;title:string})=>n.kind==='achievement'&&n.title==='Trophy unlocked: First Appearance')).toBe(true);
  // Every unseen unlock shows once, on the next page load.
  const seen=new Set<string>();
  for(let i=0;i<6;i++){
   await open(page,'/');
   const screen=page.getByRole('dialog').filter({hasText:'Trophy unlocked!'});
   if(!(await screen.isVisible().catch(()=>false))){await page.waitForTimeout(1500);if(!(await screen.isVisible()))break}
   await expect(screen.getByRole('button',{name:'Brag about it'})).toBeVisible();
   await expect(screen.getByRole('link',{name:'All trophies'})).toBeVisible();
   const name=(await screen.getByRole('heading').innerText()).trim();
   expect(seen.has(name),'each unlock shows only once: '+name).toBe(false);seen.add(name);
   await screen.getByRole('button',{name:'Close'}).click();
   await expect(screen).toHaveCount(0);
  }
  // Earned either way (a reused test database may have shown this unlock already).
  const status=await (await page.request.get('/api/trophies')).json();
  expect(status.trophies.find((t:{id:string})=>t.id==='first_appearance').earned.length).toBe(1);
  await open(page,'/');await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog').filter({hasText:'Trophy unlocked!'})).toHaveCount(0);
  // The trophy case page.
  await open(page,'/trophies');
  await expect(page.getByRole('heading',{level:1})).toContainText(/of 15 trophies earned/);
  for(const group of ['Collector','Marketplace','Community'])await expect(page.getByRole('heading',{level:2,name:group})).toBeVisible();
  await expect(page.getByRole('heading',{level:2,name:'Fair play'})).toBeVisible();
  await expect(page.getByRole('switch',{name:'Weekly recap'})).not.toBeChecked();
  await expect(page.getByRole('switch',{name:'Unlocks'})).toBeChecked();
 });
});
