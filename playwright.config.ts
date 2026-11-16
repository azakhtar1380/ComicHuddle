// End-to-end tests: real browser, the whole site on a throwaway in-memory database (scripts/e2e-server.mjs).
// Run: npx playwright test            (all journeys, desktop + phone)
//      npx playwright test --update-snapshots   (after an intended visual change, to approve new screenshots)
import {defineConfig,devices} from '@playwright/test';

const port=Number(process.env.E2E_PORT||3100),baseURL='http://localhost:'+port;
export default defineConfig({
 testDir:'e2e',
 // One shared in-memory database and a dev server that compiles pages on first visit: run in order.
 workers:1,fullyParallel:false,
 timeout:120_000,
 expect:{timeout:20_000,toHaveScreenshot:{maxDiffPixelRatio:0.02,animations:'disabled',caret:'hide'}},
 retries:process.env.CI?1:0,
 reporter:[['list'],['html',{open:'never',outputFolder:'e2e-report'}]],
 outputDir:'e2e-results',
 snapshotPathTemplate:'{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
 globalSetup:'./e2e/global-setup.ts',
 use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure',locale:'en-US',timezoneId:'America/Chicago'},
 projects:[
  {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:800}}},
  {name:'phone',use:{...devices['Pixel 7']}},
 ],
 webServer:{command:'node scripts/e2e-server.mjs',url:baseURL,reuseExistingServer:true,timeout:300_000,stdout:'ignore',stderr:'pipe'},
});
