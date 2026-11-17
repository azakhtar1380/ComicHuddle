// "Can't find the comic? Add your own": a custom comic lives only on the listing — not in the Directory or the
// seller's collection — shows a placeholder with "Not in Directory", opens a small sheet, and is word-checked.
import {test,expect,open,signedInAs} from './fixtures';
import {PHOTO,openSellForm} from './helpers';

test.describe('Custom comics in a listing',()=>{
 signedInAs('seller');
 test('a seller lists a comic that isn’t in the Directory',async({page})=>{
  test.setTimeout(240_000);
  await open(page,'/');
  const before=((await (await page.request.get('/api/vault')).json())?.books||[]).length;
  const title='Neighborhood Zine #'+Date.now().toString().slice(-5);
  const form=await openSellForm(page);
  await form.getByRole('button',{name:'Can’t find the comic? Add your own.'}).click();
  await form.locator('#builder-custom-title').fill('ab');
  await form.getByRole('button',{name:'Add to this listing'}).click();
  await expect(form.getByText('Give the comic a title (3–120 characters).')).toBeVisible();
  await form.locator('#builder-custom-title').fill(title);
  await form.locator('#builder-custom-description').fill('Hand-stapled, 24 pages, from a 1994 comic shop giveaway.');
  await form.getByRole('button',{name:'Add to this listing'}).click();
  await expect(form.getByText('Not in Directory').first()).toBeVisible();
  await form.getByRole('button',{name:/^continue/i}).click();
  await form.locator('input[type=file]').setInputFiles(PHOTO);
  await expect(form.getByRole('button',{name:/remove listing photo 1/i})).toBeVisible({timeout:60_000});
  await form.getByRole('button',{name:/^continue/i}).click();
  await form.getByLabel(/price/i).first().fill('12');
  await form.getByLabel(/your zip code/i).fill('55403');
  await expect(form.getByText('Minneapolis, MN')).toBeVisible();
  await form.getByRole('button',{name:/^preview/i}).click();
  await form.getByRole('checkbox',{name:/I own this comic/i}).check();
  await form.getByRole('checkbox',{name:/I live in the US/i}).check();
  await form.getByRole('button',{name:/publish listing/i}).click();
  await expect(form).toBeHidden({timeout:60_000});
  // Not added to the seller's collection.
  expect(((await (await page.request.get('/api/vault')).json())?.books||[]).length,'collection unchanged').toBe(before);
  // The listing: placeholder cover, "Not in Directory", and a sheet with what the seller wrote.
  const listings=(await (await page.request.get('/api/marketplace?offset=0')).json()).listings as {id:string;title:string;items:{source?:string;bookId:string}[]}[];
  const listing=listings.find(l=>l.title===title)!;
  expect(listing.items[0].source).toBe('custom');expect(listing.items[0].bookId).toBe('');
  await open(page,'/?section=Marketplace');
  await page.locator('.mpx-card',{hasText:title}).locator('.mpx-card-open').click();
  const comics=page.locator('#listing-comics');
  await expect(comics.getByText('Not in Directory')).toBeVisible();
  await comics.getByRole('button',{name:new RegExp(title.replace(/[#]/g,'.')+': see what the seller wrote')}).click();
  const sheet=page.getByRole('dialog',{name:title});
  await expect(sheet.getByText('Hand-stapled, 24 pages')).toBeVisible();
 });
 test('custom comics are checked for banned words on the server',async({page})=>{
  await open(page,'/');
  const r=await page.request.post('/api/social',{headers:{Origin:new URL(page.url()).origin},data:{action:'listing',kind:'single',saleType:'fixed',bookIds:[],customItems:[{title:'Sh1t comic',description:''}],description:'Test',price:1000,shipping:0,photos:['00000000-0000-4000-8000-000000000000'],attest:true,usaAttest:true}});
  expect(r.ok()).toBe(false);
 });
});
