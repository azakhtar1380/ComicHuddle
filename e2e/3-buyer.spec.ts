// Buyer journeys (guest and signed in): cart, listing details, messages, back button, directory facts.
// Relies on the listing the seller journey published (Planet Comics #12, $25).
import {test,expect,open,isPhone,signedInAs} from './fixtures';
import type {Page} from '@playwright/test';
import {addComicToCollection,ensureListing} from './helpers';

// Each run starts with an empty test database: make sure the seller's listing exists (the seller journey makes it).
test.beforeAll(async({browser})=>{await ensureListing(browser)});

async function openListing(page:Page,title=/planet comics #12/i){
 await open(page,'/?section=Marketplace');
 const card=page.locator('.mpx-card').filter({hasText:title}).first();
 await expect(card).toBeVisible();
 await card.locator('.mpx-card-open').click();
 const detail=page.getByRole('dialog').filter({hasText:title}).first();
 await expect(detail).toBeVisible();
 return detail;
}

test.describe('guest shopper',()=>{
 test('a guest can add to cart without signing in, see the cart, and is asked to sign in only at checkout',async({page})=>{
  const detail=await openListing(page);
  await detail.getByRole('button',{name:/^add to cart$/i}).click();
  await expect(page.getByRole('dialog',{name:/sign in to keep going/i})).toHaveCount(0);
  await expect(detail.getByRole('button',{name:/in your cart/i})).toBeVisible();
  await open(page,'/cart');
  await expect(page.getByText(/planet comics #12/i).first()).toBeVisible();
  await expect(page.getByText('$25.00').first()).toBeVisible();
  await page.getByRole('button',{name:/sign in to check out/i}).click();
  const prompt=page.getByRole('dialog');
  await expect(prompt.getByRole('link',{name:/^sign in$/i})).toHaveAttribute('href',/return_to=%2Fcart/);
  await page.getByRole('button',{name:/keep browsing/i}).click();
  await page.getByRole('button',{name:/remove/i}).first().click();
  await expect(page.getByText(/your cart is empty/i)).toBeVisible();
 });

 test('Buy now asks a guest to sign in and comes back to the same listing',async({page})=>{
  const detail=await openListing(page);
  const listingUrl=page.url();expect(listingUrl).toMatch(/listing=/);
  await detail.getByRole('button',{name:/^buy/i}).first().click();
  const signIn=page.getByRole('dialog').getByRole('link',{name:/^sign in$/i});
  await expect(signIn).toBeVisible();
  const href=await signIn.getAttribute('href');
  expect(decodeURIComponent(href!.split('return_to=')[1]||'')).toContain('listing=');
 });

 test('Messages: closing the sign-in popup leaves a "sign in to view your messages" page',async({page})=>{
  await open(page,'/');
  // The Messages icon is in the header on both desktop and phone.
  await page.getByRole('button',{name:/^messages$/i}).first().click();
  const prompt=page.getByRole('dialog',{name:/sign in to keep going/i});
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button',{name:/close/i}).click();
  await expect(page.getByText(/sign in to view your messages/i)).toBeVisible();
  await expect(page).toHaveURL(/section=Messages/);
 });

 test('the browser Back button works between sections and listings',async({page})=>{
  await open(page,'/');
  await page.goto('/?section=Marketplace');await page.waitForLoadState('networkidle').catch(()=>undefined);
  const detail=await openListing(page);
  await page.goBack();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(/section=Marketplace(?!.*listing=)/);
  // Section to section through the site's own navigation, then Back.
  await open(page,'/');
  const nav=isPhone(page)?page.getByRole('link',{name:/market/i}).last():page.getByRole('link',{name:/^marketplace$/i}).first();
  await nav.click();
  await expect(page).toHaveURL(/section=Marketplace/);
  await page.goBack();
  await expect(page).not.toHaveURL(/section=Marketplace/);
  await expect(page.getByRole('heading',{level:1})).toContainText(/comic/i);
 });

 test('home directory cards have a Peek inside button',async({page})=>{
  await open(page,'/');
  const peek=page.locator('.home-cover .home-peek').first();
  await peek.scrollIntoViewIfNeeded();
  await expect(peek).toBeVisible();
  await expect(peek).toHaveText(/peek inside/i);
 });

 test('Incredible Hulk #181 is described as Wolverine’s first full appearance',async({page})=>{
  await open(page,'/?section=Directory');
  const search=page.getByRole('combobox',{name:/search the directory/i});
  await search.fill('Incredible Hulk');await search.press('Enter');
  await page.waitForLoadState('networkidle').catch(()=>undefined);
  await page.getByRole('button',{name:/peek inside .*hulk #181/i}).first().click();
  await expect(page.getByText(/first full appearance of wolverine/i).first()).toBeVisible();
 });
});

test.describe('signed-in buyer',()=>{
 signedInAs('buyer');
 test('listing shows price, seller and buying options; checkout says when payments are off',async({page})=>{
  const detail=await openListing(page);
  await expect(detail.getByText('$25.00').first()).toBeVisible();
  await expect(detail.getByText(/QA Seller/).first()).toBeVisible();
  await detail.getByRole('button',{name:/^add to cart$/i}).click();
  await expect(detail.getByRole('button',{name:/in your cart/i})).toBeVisible();
  await open(page,'/cart');
  await expect(page.getByText(/planet comics #12/i).first()).toBeVisible();
  await expect(page.getByText(/online checkout is unavailable/i)).toBeVisible();
  await page.getByRole('button',{name:/remove/i}).first().click();
  await expect(page.getByText(/your cart is empty/i)).toBeVisible();
 });

 test('Orders, Wallet and Messages open for a signed-in buyer',async({page})=>{
  await open(page,'/?section=Orders');
  await expect(page.getByText(/sign in to/i)).toHaveCount(0);
  await open(page,'/?section=Wallet');
  await expect(page.getByRole('heading',{name:/card for auctions/i})).toBeVisible();
  await open(page,'/?section=Messages');
  await expect(page.getByText(/sign in to view your messages/i)).toHaveCount(0);
 });

 test('a buyer cannot open admin pages',async({page})=>{
  await open(page,'/admin');
  await expect(page.getByText(/audit log/i)).toHaveCount(0);
 });
});

test.describe('signed-in trader',()=>{
 signedInAs('buyer');
 test('a buyer proposes a trade with a comic they own; the seller gets the terms in Messages',async({page})=>{
  await page.goto('/');await addComicToCollection(page);
  const detail=await openListing(page);
  await detail.getByRole('button',{name:/^trade$/i}).click();
  const form=detail.locator('form.mpx-trade');
  await expect(form).toBeVisible();
  await form.getByRole('checkbox',{name:/incredible hulk/i}).check();
  await form.locator('input[type=checkbox][required]').check();
  await form.getByRole('button',{name:/send proposal/i}).click();
  // Success: the conversation opens with the trade terms card waiting on the seller.
  await expect(page).toHaveURL(/section=Messages/);
  await expect(page.getByText(/waiting on seller/i).first()).toBeVisible();
  await expect(page.getByText(/incredible hulk #181/i).first()).toBeVisible();
 });
});

test.describe('signed-in offer',()=>{
 signedInAs('buyer');
 test('making an offer reports back inside the listing window, never on the page behind it',async({page})=>{
  const detail=await openListing(page);
  await detail.getByRole('button',{name:/make an offer/i}).click();
  const form=detail.locator('form.mpx-form').filter({has:page.locator('[name=amount]')});
  await form.locator('[name=amount]').fill('20');
  const note=form.locator('[name=note]');if(await note.count())await note.fill('Would you take $20?');
  for(const box of await form.locator('input[type=checkbox][required]').all())await box.check();
  await form.getByRole('button',{name:/send|make|offer/i}).last().click();
  await expect(detail.locator('.mpx-detail-message')).toBeVisible();
  await expect(page.locator('.marketplace-page > .ds-error')).toHaveCount(0);
 });
});
