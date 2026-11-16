// Seller journeys: listing a comic end to end (pick, photo, ZIP, drafts, publish), and what the listing looks like.
import {test,expect,open,signedInAs} from './fixtures';
import type {Page} from '@playwright/test';

const PHOTO='public/covers/planet-12.jpg';
signedInAs('seller');
test.describe.configure({mode:'serial'});

async function openSellForm(page:Page){
 await open(page,'/?section=Marketplace');
 await page.getByRole('button',{name:/sell a comic/i}).first().click();
 const form=page.getByRole('dialog',{name:/sell a comic/i});
 await expect(form).toBeVisible();
 return form;
}
async function pickComic(page:Page,form:ReturnType<Page['getByRole']>,query='Planet Comics'){
 const search=form.getByPlaceholder(/search by title/i).or(form.getByRole('combobox')).first();
 await search.fill(query);
 const option=page.getByRole('listbox',{name:/matching comic/i}).getByRole('option').first();
 await expect(option).toBeVisible();
 await option.click();
}

test.describe('seller',()=>{
 test('Sell a comic starts empty; nothing is saved until a comic is picked',async({page})=>{
  const form=await openSellForm(page);
  await form.getByRole('button',{name:/save draft/i}).click();
  await expect(form.getByText(/pick a comic first/i)).toBeVisible();
 });

 test('ZIP is checked as you type, and a wrong ZIP is explained next to the field',async({page})=>{
  const form=await openSellForm(page);
  await pickComic(page,form);
  await form.getByRole('button',{name:/^continue/i}).click();
  await form.locator('input[type=file]').setInputFiles(PHOTO);
  await expect(form.getByRole('button',{name:/remove listing photo 1/i})).toBeVisible({timeout:60_000});
  await form.getByRole('button',{name:/^continue/i}).click();
  const zip=form.getByLabel(/your zip code/i);
  await zip.fill('55403');
  await expect(form.getByText('Minneapolis, MN')).toBeVisible();
  await zip.fill('00000');
  await expect(form.getByText(/couldn’t find ZIP 00000/i)).toBeVisible();
  // The form itself, not the page behind it, shows the problem.
  await expect(form.getByRole('alert').first()).toBeVisible();
 });

 test('Save draft and close puts it under Your drafts; Continue reopens it; Delete removes it',async({page})=>{
  // Earlier unfinished listings autosave as drafts too, so count relative to what is already there.
  const before=((await (await page.request.get('/api/listing-draft?list=1')).json()).drafts as unknown[]).length;
  const form=await openSellForm(page);
  await pickComic(page,form,'Planet Comics #21');
  await form.getByRole('button',{name:/save draft/i}).click();
  await expect(form).toBeHidden();
  await expect(page.getByText(/draft saved/i).first()).toBeVisible();
  const drafts=page.getByRole('region',{name:/your drafts/i});
  await expect(drafts.getByRole('listitem')).toHaveCount(before+1);
  const mine=drafts.getByRole('listitem').first(); // newest first, highlighted
  await expect(mine).toHaveClass(/is-new/);
  await mine.getByRole('button',{name:/continue/i}).click();
  const reopened=page.getByRole('dialog',{name:/sell a comic/i});
  await expect(reopened.getByText(/planet comics #21/i).first()).toBeVisible();
  await expect(reopened.getByText(/two versions of this draft/i)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reopened).toBeHidden();
  page.once('dialog',dialog=>dialog.accept());
  await drafts.getByRole('listitem').first().getByRole('button',{name:/delete draft/i}).click();
  await expect(drafts.getByRole('listitem')).toHaveCount(before);
 });

 test('publish a listing with a photo; it shows on the marketplace with that photo',async({page})=>{
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
  await expect(page.getByText(/your listing is live/i).first()).toBeVisible();
  await open(page,'/?section=Marketplace');
  const card=page.locator('.mpx-card').filter({hasText:/planet comics/i}).first();
  await expect(card).toBeVisible();
  const photo=card.locator('img').first();
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(()=>photo.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
  // No empty SafePurchase mark on a card when SafePurchase is off.
  await expect(card.locator('.ch-sp-badge')).toHaveCount(0);
 });
});
