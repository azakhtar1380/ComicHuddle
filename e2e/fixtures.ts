// Shared test setup. Every test also fails if the page throws a JavaScript error, logs a console error, or one of
// our own requests returns a server error (5xx), so silent breakage is caught, not just missing text.
import {test as base,expect,type Page} from '@playwright/test';
import {authFile,type Role} from './accounts';

// Known, harmless noise only. Keep this list short and explain every entry.
const IGNORED=[
 /Download the React DevTools/i,
 /\[Fast Refresh\]|\[HMR\]/i,                 // dev-server reload messages
 /Blocked script execution in 'about:srcdoc'/i, // admin email previews are sandboxed iframes on purpose (emails never run scripts)
 /Failed to load resource: the server responded with a status of 4\d\d/i, // expected 401/404s are checked by the tests themselves
];
type Problems={errors:string[]};
export const test=base.extend<{problems:Problems}>({
 problems:[async({page},use,testInfo)=>{
  const problems:Problems={errors:[]};
  // The full-screen 'Trophy unlocked!' screen shows once on the next page load after a trophy is earned.
  // Tests that aren't about trophies close it whenever it gets in the way (e2e/10-trophies.spec.ts checks it).
  await page.addLocatorHandler(page.getByRole('dialog').filter({hasText:'Trophy unlocked!'}),async overlay=>{await overlay.getByRole('button',{name:'Close'}).click()},{noWaitAfter:true});
  page.on('pageerror',error=>problems.errors.push('Page error: '+error.message));
  page.on('console',message=>{if(message.type()==='error'&&!IGNORED.some(rule=>rule.test(message.text())))problems.errors.push('Console error: '+message.text().slice(0,300))});
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===new URL(testInfo.project.use.baseURL!).origin&&response.status()>=500)problems.errors.push('Server error '+response.status()+': '+url.pathname+url.search)});
  await use(problems);
  expect(problems.errors,'No JavaScript errors, console errors or server errors on the page').toEqual([]);
 },{auto:true}],
});
export {expect};
/** Use inside a describe block: every test in it runs signed in as this account. */
export const signedInAs=(role:Role)=>test.use({storageState:authFile(role)});
export const isPhone=(page:Page)=>(page.viewportSize()?.width??1280)<700;
/** Opens a page and waits for the app to settle (dev server compiles on first visit). */
export async function open(page:Page,path:string){
 const response=await page.goto(path,{waitUntil:'domcontentloaded'});
 await page.waitForLoadState('networkidle',{timeout:60_000}).catch(()=>undefined);
 return response;
}
