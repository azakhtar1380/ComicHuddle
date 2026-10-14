import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'**/*.spec.mjs',fullyParallel:false,
  timeout:30000,retries:0,reporter:'list',projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
