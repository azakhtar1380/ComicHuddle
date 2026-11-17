// Profile Overview: the owner picks the six, favorite character, favorite comic and the WANTED grail from the
// Directory on the page itself (sheets that save right away), and the Edit profile form no longer edits them.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';
import type {Page} from '@playwright/test';

const handle=ACCOUNTS.buyer.handle;
const section=(page:Page,name:RegExp)=>page.getByRole('region',{name});
async function pickIssue(page:Page,dialog:ReturnType<Page['getByRole']>,nth=0){
 await dialog.getByRole('combobox').first().fill('Planet Comics');
 const option=page.getByRole('listbox',{name:/matching comic/i}).getByRole('option').nth(nth);
 await expect(option).toBeVisible();await option.click();
}
async function save(page:Page,dialog:ReturnType<Page['getByRole']>,message:string){
 await dialog.getByRole('button',{name:'Save'}).click();
 await expect(page.getByText(message)).toBeVisible();
 await expect(dialog).toBeHidden();
}

test.describe('Overview picks from the Directory',()=>{
 signedInAs('buyer');
 test('pick the six, a character, a comic and the WANTED grail without a reload',async({page})=>{
  await open(page,'/@'+handle);
  // Start empty (the test database can be reused between device sizes).
  const reset=await page.request.post('/api/profile-extras',{headers:{Origin:new URL(page.url()).origin},data:{featured:[],favoriteCharacterId:null,favoriteIssueId:null,grailIssueId:null,grailReward:''}});
  expect(reset.ok(),await reset.text()).toBe(true);
  await open(page,'/@'+handle);
  let loads=0;page.on('load',()=>{loads++});

  // The six: pick two, swap their order, save.
  await section(page,/Favorites$/).getByRole('button',{name:'Pick from the Directory'}).click();
  const six=page.getByRole('dialog',{name:'The six'});
  await pickIssue(page,six,0);await pickIssue(page,six,1);
  const order=six.getByRole('list',{name:'Your six, in order'}).getByRole('listitem');
  await expect(order).toHaveCount(2);
  const first=await order.first().locator('.dp-name').innerText();
  await six.getByRole('button',{name:'Move '+first+' down'}).click();
  await expect(order.nth(1).locator('.dp-name')).toHaveText(first);
  await save(page,six,'Favorites saved.');
  await expect(page.getByRole('list',{name:'Six favorites'}).getByRole('listitem')).toHaveCount(2);

  // Favorite character from the Character Directory.
  await section(page,/^Favorite character$/).getByRole('button',{name:'Pick from the Directory'}).click();
  const character=page.getByRole('dialog',{name:'Favorite character'});
  await character.getByLabel('Search the Character Directory').fill('mysta');
  await character.getByRole('button',{name:/Mysta of the Moon/}).click();
  await save(page,character,'Favorite character saved.');
  await expect(page.getByRole('link',{name:/Mysta of the Moon/})).toBeVisible();

  // Favorite comic.
  await section(page,/^Favorite comic$/).getByRole('button',{name:'Pick from the Directory'}).click();
  const comic=page.getByRole('dialog',{name:'Favorite comic'});
  await pickIssue(page,comic);
  await save(page,comic,'Favorite comic saved.');
  await expect(section(page,/^Favorite comic$/).getByText(/Planet Comics/)).toBeVisible();

  // WANTED with a reward (60 characters max).
  await section(page,/^WANTED$/).getByRole('button',{name:'Pick from the Directory'}).click();
  const wanted=page.getByRole('dialog',{name:'WANTED'});
  await pickIssue(page,wanted);
  await expect(wanted.getByLabel(/Reward/)).toHaveAttribute('maxlength','60');
  await wanted.getByLabel(/Reward/).fill('Top dollar');
  await save(page,wanted,'Wanted poster saved.');
  await expect(page.getByText('Reward: Top dollar')).toBeVisible();
  expect(loads,'saved without a page reload').toBe(0);

  // Once filled, each section has a small Edit button; the Edit profile form only keeps tags.
  for(const name of ['Edit favorites','Edit favorite character','Edit favorite comic','Edit wanted poster'])await expect(page.getByRole('button',{name})).toBeVisible();
  await page.getByRole('button',{name:'More profile options'}).click();await page.getByRole('menuitem',{name:'Edit profile'}).click();
  const form=page.getByRole('dialog').filter({has:page.getByRole('button',{name:/Save showcase/})});
  await expect(form.getByText('Tags',{exact:true})).toBeVisible();
  for(const gone of ['Six favorites','Favorite character','Favorite comic','Reward line'])await expect(form.getByText(gone,{exact:true})).toHaveCount(0);

  // Visitors see the picks.
  const guest=await page.context().browser()!.newContext({storageState:{cookies:[],origins:[]}}),g=await guest.newPage();
  await open(g,'/@'+handle);
  await expect(g.getByRole('link',{name:/Mysta of the Moon/})).toBeVisible();
  await expect(g.getByText('Reward: Top dollar')).toBeVisible();
  await expect(g.getByRole('button',{name:'Pick from the Directory'})).toHaveCount(0);
  await guest.close();
 });
});
