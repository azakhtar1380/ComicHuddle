// Worlds: the Theme screen saves a world, ink, frame and sound effect, and visitors see it on the public page.
import {test,expect,open,signedInAs} from './fixtures';
import {ACCOUNTS} from './accounts';

test.describe('Worlds',()=>{
 signedInAs('seller');
 test('a theme save shows on the public page',async({page,browser})=>{
  await open(page,'/@'+ACCOUNTS.seller.handle);
  await page.getByRole('button',{name:'Theme',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Pick your world'});
  await expect(dialog.getByText('All free')).toBeVisible();
  await expect(dialog.locator('.ts-world')).toHaveCount(10);
  await dialog.getByText('Gargoyle City').click();
  await dialog.getByText('Silver Age').click();
  await dialog.getByText('Panel',{exact:true}).click();
  await dialog.getByText('KRAK!',{exact:true}).click();
  await expect(dialog.locator('.ts-preview')).toHaveClass(/pp-world-gargoyle/);
  await expect(dialog.locator('.ts-sfx')).toHaveText('KRAK!');
  await dialog.getByRole('button',{name:'Save my world'}).click();
  await expect(page.getByText('Your world is saved.')).toBeVisible();
  const guest=await browser.newContext({storageState:{cookies:[],origins:[]}});const g=await guest.newPage();
  await open(g,'/@'+ACCOUNTS.seller.handle);
  const article=g.locator('article.pp');
  await expect(article).toHaveAttribute('data-world','gargoyle');
  await expect(article).toHaveClass(/pp-ink-silver/);
  await expect(article.locator('.pp-photo-wrap')).toHaveClass(/pp-frame-panel/);
  await expect(article.locator('.pp-sfx')).toHaveText('KRAK!');
  await expect(g.getByRole('button',{name:'Theme',exact:true})).toHaveCount(0);
  await guest.close();
  // Back to the default so other tests see the classic look.
  const r=await page.request.post('/api/profile-extras',{headers:{Origin:new URL(page.url()).origin},data:{world:'classic',ink:'golden',frame:'circle',sfx:'POW!'}});
  expect(r.ok()).toBe(true);
 });
});
