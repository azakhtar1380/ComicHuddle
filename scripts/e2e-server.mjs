// End-to-end test server: the whole site on a throwaway in-memory database (db/local-dev.ts), on port 3100.
// No real database, payment provider, carrier, Metron or AWS is reached: those settings are blanked here, and an
// empty value stops Next from filling them in from .env.local. Accounts are created fresh by the tests each run.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

process.chdir(fileURLToPath(new URL('..',import.meta.url))); // run from the project folder wherever it was started

const port=process.env.E2E_PORT||'3100',origin='http://localhost:'+port;
const env={...process.env,
 CH_LOCAL_DB:'pglite',NODE_ENV:'development',
 BETTER_AUTH_URL:origin,COMMERCE_PUBLIC_ORIGIN:origin,
 // The admin test account (created by the tests, never a real person's login).
 COMICHUDDLE_ADMIN_EMAILS:'e2e-admin@comichuddle.test',
 // Online payments stay off in these tests: checkout shows its "unavailable" state, nothing reaches Stripe.
 COMMERCE_SANDBOX_ENABLED:'',COMMERCE_SANDBOX_REVIEWED:'',COMMERCE_STRIPE_MODE:'',COMMERCE_STRIPE_TEST_SECRET_KEY:'',COMMERCE_STRIPE_TEST_PUBLISHABLE_KEY:'',COMMERCE_STRIPE_TEST_WEBHOOK_SECRET:'',
 EASYPOST_API_KEY:'',METRON_API_TOKEN:'',METRON_UPC_ENABLED:'',COVER_DIRECT_DISPLAY:'',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',AWS_REGION:'',VERCEL_OIDC_TOKEN:'',
 LOCAL_QA_EMAIL:'',LOCAL_QA_PASSWORD:'',LOCAL_QA_NAME:'',
 NEXT_TELEMETRY_DISABLED:'1',
 // Emails are kept in memory, never sent.
 EMAIL_TEST_OUTBOX:'1',VERIFICATION_FEE_CENTS:'0', // no Stripe locally: verification requests go straight to review
RESEND_API_KEY:'',EMAIL_FROM:'',
};
// Without .env.local (for example on a build server) sessions are signed with a test-only secret.
if(!env.BETTER_AUTH_SECRET&&!existsSync('.env.local'))env.BETTER_AUTH_SECRET='e2e-only-session-secret-never-used-in-production';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-p',port],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??0));
