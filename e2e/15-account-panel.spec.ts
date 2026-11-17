// Account panel: "Get verified" is a normal row, first under "You", with a status pill; "My profile" opens My
// Profile; the drawer slides with transform only, locks the page without a sideways jump, and Escape returns focus.
import {test,expect,open,signedInAs,isPhone} from './fixtures';

test.describe('Account panel',()=>{
 signedInAs('buyer');
 test.beforeEach(({page})=>{test.skip(isPhone(page),'the Account button is in the desktop header')});
 test('Get verified row, My profile, smooth drawer and focus back to the account button',async({page})=>{
  await open(page,'/');
  const account=page.getByRole('button',{name:'Open your account'});
  const widthBefore=await page.evaluate(()=>document.documentElement.clientWidth);
  await account.click();
  const panel=page.getByRole('dialog',{name:'Your account'});
  await expect(panel).toBeVisible();
  // Only transform/opacity animate; the page doesn't shift sideways when scrolling is locked.
  const anim=await panel.evaluate(el=>{const s=getComputedStyle(el);return {name:s.animationName,dur:s.animationDuration}});
  expect(anim.name).toBe('ap-slide');expect(anim.dur).toBe('0.22s');
  expect(await page.evaluate(()=>getComputedStyle(document.querySelector('.drawer-overlay')!).backdropFilter)).toBe('none');
  expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).toBe('hidden');
  const header=page.locator('.chx').first();
  expect(Math.round((await header.boundingBox())!.width)).toBeGreaterThanOrEqual(widthBefore-1);
  // "You": Get verified first, with a status pill.
  const you=panel.getByRole('region',{name:'You'});
  const rows=you.getByRole('button');
  await expect(rows.first()).toContainText(/Get verified|Verified/);
  await expect(rows.first().locator('.gv-pill-row')).toHaveText(/Not verified|Pending|Verified/);
  await expect(panel.getByText('Profile & showcase')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(account).toBeFocused();
  // My profile opens My Profile.
  await account.click();
  await page.getByRole('dialog',{name:'Your account'}).getByRole('button',{name:'My profile',exact:true}).click();
  await expect(page.getByText('MY PROFILE',{exact:true})).toBeVisible();
 });
});
