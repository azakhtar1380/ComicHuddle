// Notifications: a dropdown hanging from the bell on every screen size — fully on screen at 360/390/430/1280, the
// pointer under the bell, above the header, chips scroll inside it. Escape closes it and focus returns to the bell.
import {test,expect,open,signedInAs,isPhone} from './fixtures';

test.describe('Notifications panel',()=>{
 signedInAs('buyer');
 test('hangs from the bell inside the screen; pointer under the bell; Escape returns focus',async({page})=>{
  const widths=isPhone(page)?[360,390,430]:[1280];
  for(const width of widths){
   await page.setViewportSize({width,height:width<700?860:800});
   await open(page,'/');
   const bell=page.getByRole('button',{name:/^Notifications/}).first();
   await bell.click();
   const panel=page.getByRole('dialog',{name:'Notifications'});
   await expect(panel).toBeVisible();
   await page.waitForTimeout(250);                                   // the 160ms open animation
   const box=(await panel.boundingBox())!,b=(await bell.boundingBox())!;
   expect(box.x,'12px inside the left edge').toBeGreaterThanOrEqual(11);
   expect(box.x+box.width,'12px inside the right edge').toBeLessThanOrEqual(width-11);
   expect(box.y,'just under the bell').toBeGreaterThan(b.y+b.height-1);
   const arrow=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return r.left+parseFloat(getComputedStyle(el).getPropertyValue('--nb-arrow'))});
   expect(Math.abs(arrow-(b.x+b.width/2)),'pointer lines up with the bell').toBeLessThan(3);
   const covered=await panel.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+20);return !!hit&&!el.contains(hit)});
   expect(covered,'nothing in the header covers it').toBe(false);
   await expect(panel.getByRole('heading',{name:'Notifications'})).toBeVisible();
   const chips=panel.getByRole('toolbar',{name:'Filter notifications'}),c=(await chips.boundingBox())!;
   expect(c.x).toBeGreaterThanOrEqual(box.x-1);expect(c.x+c.width).toBeLessThanOrEqual(box.x+box.width+1);
   expect(await chips.evaluate(el=>getComputedStyle(el).overflowX)).toBe('auto');
   await page.keyboard.press('Escape');
   await expect(panel).toBeHidden();
   await expect(bell).toBeFocused();
  }
 });
});
