// Shared steps used by more than one journey.
import {expect,type Browser,type Page} from '@playwright/test';
import {authFile} from './accounts';

export const PHOTO='public/covers/planet-12.jpg';
export async function openSellForm(page:Page){
 await page.goto('/?section=Marketplace');await page.waitForLoadState('networkidle').catch(()=>undefined);
 await page.getByRole('button',{name:/sell a comic/i}).first().click();
 const form=page.getByRole('dialog',{name:/sell a comic/i});
 await expect(form).toBeVisible();
 return form;
}
export async function pickComic(page:Page,form:ReturnType<Page['getByRole']>,query='Planet Comics'){
 const search=form.getByPlaceholder(/search by title/i).or(form.getByRole('combobox')).first();
 await search.fill(query);
 const option=page.getByRole('listbox',{name:/matching comic/i}).getByRole('option').first();
 await expect(option).toBeVisible();
 await option.click();
}
/** Publishes "Planet Comics #12" for $25 with a photo, as the seller. */
export async function publishListing(page:Page){
 const form=await openSellForm(page);
 await pickComic(page,form);
 await form.getByRole('button',{name:/^continue/i}).click();
 await form.locator('input[type=file]').setInputFiles(PHOTO);
 await expect(form.getByRole('button',{name:/remove listing photo 1/i})).toBeVisible({timeout:60_000});
 await form.getByRole('button',{name:/^continue/i}).click();
 await form.getByLabel(/price/i).first().fill('25');
 await form.getByLabel(/your zip code/i).fill('55403');
 await expect(form.getByText('Minneapolis, MN')).toBeVisible();
 await form.getByRole('button',{name:/^preview/i}).click();
 await form.getByRole('checkbox',{name:/I own this comic/i}).check();
 await form.getByRole('checkbox',{name:/I live in the US/i}).check();
 await form.getByRole('button',{name:/publish listing/i}).click();
 await expect(form).toBeHidden({timeout:60_000});
}
/** Makes sure the seller's Planet Comics #12 listing is live (for journeys run on their own). */
export async function ensureListing(browser:Browser){
 const context=await browser.newContext({storageState:authFile('seller')}),page=await context.newPage();
 const listings=await (await page.request.get('/api/marketplace?offset=0')).json().catch(()=>({listings:[]}));
 if(!(listings.listings||[]).some((l:{title:string;status?:string})=>/planet comics #12/i.test(l.title)))await publishListing(page);
 await context.close();
}
/** Puts one comic in the signed-in account's collection (through the normal collection API). */
export async function addComicToCollection(page:Page,title='Incredible Hulk',issue='#181'){
 const {emptyVault}=await import('../lib/vault');
 const current=await page.request.get('/api/vault');
 const version=current.headers()['x-comichuddle-vault-version']||current.headers()['etag']||'';
 const vault=(await current.json())||emptyVault('QA Buyer');
 if(vault.books.some((b:{title:string;issue:string})=>b.title===title&&b.issue===issue))return;
 vault.books.push({id:crypto.randomUUID(),title,issue,grade:'Raw 6.0',price:0,catalogId:10}); // 10 = Incredible Hulk #181 in the curated catalog
 const saved=await page.request.post('/api/vault',{data:vault,headers:{'If-Match':version,'X-ComicHuddle-Vault-Version':version,Origin:'http://localhost:'+(process.env.E2E_PORT||3100)}});
 expect(saved.ok(),'collection saved: '+(await saved.text()).slice(0,200)).toBe(true);
}
