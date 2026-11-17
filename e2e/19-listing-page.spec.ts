// Listing page: card images load (no 404s, nothing empty), the seller's photos are on top in a 4:5 gallery,
// "Comics in this listing (n)" comes next with each comic's own cover (never a listing photo), and tapping a
// comic opens its issue details.
import {test,expect,open,signedInAs} from './fixtures';
import {ensureListing} from './helpers';

test.describe('Listing page',()=>{
 signedInAs('buyer');
 test('images load; photos on top; comics in this listing open their issue',async({page,browser})=>{
  await ensureListing(browser);
  const failed:string[]=[];
  page.on('response',r=>{if(r.request().resourceType()==='image'&&r.status()>=400)failed.push(r.status()+' '+r.url())});
  await open(page,'/?section=Marketplace');
  const cards=page.locator('.mpx-card');
  await expect(cards.first()).toBeVisible();
  await page.waitForTimeout(1500);
  // Every card shows something: a loaded image, or a placeholder with text.
  const empty=await cards.evaluateAll(list=>list.map((card,i)=>{const imgs=[...card.querySelectorAll('.mpx-card-art img')] as HTMLImageElement[];
   if(imgs.length)return imgs.every(img=>img.complete&&img.naturalWidth>0&&img.getBoundingClientRect().width>10)?null:'card '+i+': image did not load or is hidden';
   const art=card.querySelector('.mpx-card-art') as HTMLElement|null;return art&&art.innerText.trim()?null:'card '+i+': empty art'}).filter(Boolean));
  expect(empty,'no empty or broken card images').toEqual([]);
  expect(failed,'no image 404s').toEqual([]);
  // The listing page.
  await page.locator('.mpx-card-open').first().click();
  const dialog=page.getByRole('dialog').filter({has:page.locator('.mpx-gallery')});
  await expect(dialog).toBeVisible();
  const gallery=dialog.locator('.mpx-gallery');
  const hasPhotos=await gallery.locator('.lg-frame').count()>0;
  if(hasPhotos){
   const frame=(await gallery.locator('.lg-frame').boundingBox())!;
   expect(Math.abs(frame.width/frame.height-0.8),'4:5 frame').toBeLessThan(0.02);
   expect(await gallery.locator('.lg-slide img').first().evaluate(img=>getComputedStyle(img).objectFit)).toBe('contain');
  }else await expect(gallery.getByText('Stock image')).toBeVisible();
  const comics=dialog.locator('#listing-comics');
  await expect(comics.getByRole('heading',{name:/^Comics in this listing \(\d+\)$/})).toBeVisible();
  // Each comic's cover (or placeholder) is actually on screen: CSS once hid the cover wrapper, leaving a blank box.
  const thumbs=await comics.locator('.mp-item-art').evaluateAll(list=>list.map(el=>{const c=el.querySelector('.resolved-cover,.comic-cover-placeholder');const r=c?.getBoundingClientRect();return !!r&&r.width>10&&r.height>10}));
  expect(thumbs.length).toBeGreaterThan(0);expect(thumbs.every(Boolean),'comic covers render with a size').toBe(true);
  // A comic's cover is never one of the listing photos.
  const listingPhotos=await gallery.locator('.lg-slide img').evaluateAll(list=>list.map(img=>(img as HTMLImageElement).getAttribute('src')));
  const comicImgs=await comics.locator('img').evaluateAll(list=>list.map(img=>(img as HTMLImageElement).getAttribute('src')));
  for(const src of comicImgs)expect(listingPhotos,'comic cover reuses a listing photo').not.toContain(src);
  // Order: comics come before the description/seller card.
  const order=await dialog.evaluate(d=>{const y=(sel:string)=>d.querySelector(sel)?.getBoundingClientRect().top??Infinity;return {comics:y('#listing-comics'),seller:y('.mpx-seller-card')}});
  expect(order.comics).toBeLessThan(order.seller);
  // Tapping a Directory comic opens its issue details.
  const link=comics.locator('.mpx-manifest-item.is-link').first();
  if(await link.count()){await link.click();await expect(page.getByRole('dialog',{name:'Issue details'}).or(page.locator('.issue-showcase')).first()).toBeVisible()}
  expect(failed,'no image 404s on the listing page').toEqual([]);
 });
});
