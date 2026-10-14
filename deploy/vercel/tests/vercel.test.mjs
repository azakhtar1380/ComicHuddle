import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVercelHandler} from '../server/vercel-handler.mjs';
const env={CRON_SECRET:'test-only-cron-secret',PUBLIC_ORIGIN:'https://example.test'};
test('Cron rejects an unauthenticated request before touching database or providers',async()=>{
 const handler=createVercelHandler({env,getPool:()=>{throw Error('must not connect')},runSync:()=>{throw Error('must not run')}});
 assert.equal((await handler(new Request('https://example.test/api/cron/new-releases'))).status,401);
});
test('Cron without authorized feeds reports skipped and does not import data',async()=>{
 const handler=createVercelHandler({env,getPool:()=>{throw Error('must not connect')},runSync:()=>{throw Error('must not run')}});
 const response=await handler(new Request('https://example.test/api/index?__ch_path=/api/cron/new-releases',{headers:{Authorization:'Bearer '+env.CRON_SECRET}}));
 assert.equal(response.status,200);assert.equal((await response.json()).status,'skipped');
});
test('Configured Cron calls the provider worker and returns actual count',async()=>{
 const handler=createVercelHandler({env:{...env,SOURCE_METADATA_RIGHTS_REFERENCE:'approved-fixture',METRON_API_TOKEN:'test-only'},runSync:async()=>({updated:3}),getPool:()=>{throw Error('unexpected pool')}});
 const response=await handler(new Request('https://example.test/api/cron/new-releases',{headers:{Authorization:'Bearer '+env.CRON_SECRET}}));
 assert.deepEqual(await response.json(),{status:'completed',updated:3});
});
test('API routing preserves same-origin checks',async()=>{
 const handler=createVercelHandler({env,getPool:async()=>({query:()=>{throw Error('must not write')}})});
 const response=await handler(new Request('https://example.test/api/index?__ch_path=/api/session',{method:'POST',headers:{Origin:'https://attacker.test'}}));
 assert.equal(response.status,403);
});
test('Health checks PostgreSQL through the serverless entry point',async()=>{
 let queried=false;const handler=createVercelHandler({env,getPool:async()=>({query:async(sql)=>{assert.equal(sql,'SELECT 1');queried=true}})});
 const response=await handler(new Request('https://example.test/api/index?__ch_path=/health'));
 assert.equal(response.status,200);assert.equal(queried,true);
});
test('Weekly Cron configuration and TLS assets are included',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.crons,[{path:'/api/cron/new-releases',schedule:'0 9 * * 1'}]);
 assert.match(config.functions['api/index.mjs'].includeFiles,/certificates/);
});
