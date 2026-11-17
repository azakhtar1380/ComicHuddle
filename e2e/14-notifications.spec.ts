// Notifications: a bottom sheet under 640px (full width, nothing cut off, chips scroll inside it, body scroll
// locked); a dropdown inside the window on desktop, above the header. Escape closes and focus returns to the bell.
import {test,expect,open,signedInAs,isPhone} from './fixtures';

test.describe('Notifications panel',()=>{
 signedInAs('buyer');
 test('opens inside the screen, filters scroll inside it, Escape returns focus to the bell',async({page})=>{
  const widths=isPhone(page)?[360,390,430]:[1280];
  for(const width of widths){
   await page.setViewportSize({width,height:width<700?860:800});
   await open(page,'/');
   const bell=page.getByRole('button',{name:/^Notifications/}).first();
   await bell.click();
   const panel=page.getByRole('dialog',{name:'Notifications'});
   await expect(panel).toBeVisible();
   const box=(await panel.boundingBox())!;
   expect(box.x,'inside the left edge').toBeGreaterThanOrEqual(width<640?0:12);
   expect(box.x+box.width,'inside the right edge').toBeLessThanOrEqual(width-(width<640?0:12)+1);
   if(width<640){
    expect(box.width,'full width').toBeGreaterThanOrEqual(width-1);
    expect(box.y+box.height,'docked to the bottom').toBeGreaterThanOrEqual(page.viewportSize()!.height-2);
    expect(await page.evaluate(()=>getComputedStyle(document.body).overflow),'page scroll locked').toBe('hidden');
   }else{
    // Nothing in the header covers it.
    const covered=await panel.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+20);return !!hit&&!el.contains(hit)});
    expect(covered,'panel is on top').toBe(false);
   }
   await expect(panel.getByRole('heading',{name:'Notifications'})).toBeVisible();
   const chips=panel.getByRole('toolbar',{name:'Filter notifications'}),c=(await chips.boundingBox())!;
   expect(c.x).toBeGreaterThanOrEqual(box.x-1);expect(c.x+c.width).toBeLessThanOrEqual(box.x+box.width+1);
   expect(await chips.evaluate(el=>getComputedStyle(el).overflowX)).toBe('auto');
   for(const name of ['All','Trophies','Orders','Offers','Community'])await expect(chips.getByRole('button',{name})).toHaveCount(1);
   await page.keyboard.press('Escape');
   await expect(panel).toBeHidden();
   await expect(bell).toBeFocused();
  }
 });
});
