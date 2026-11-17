// Run: node --import tsx --test checks/social-auth.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {appleClientSecret,appleEnabled,googleEnabled,socialProviders} from '../lib/social-auth';

test('providers turn on only with their env vars',()=>{
 assert.deepEqual(Object.keys(socialProviders({})),[]);
 assert.equal(googleEnabled({GOOGLE_CLIENT_ID:'x'}),false);
 assert.deepEqual(Object.keys(socialProviders({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'s'})),['google']);
 assert.equal(appleEnabled({APPLE_CLIENT_ID:'com.x',APPLE_TEAM_ID:'T'}),false);
});

test('Apple client secret is an ES256 JWT for appleid.apple.com, signed with the .p8 key (escaped newlines accepted)',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString().replace(/\n/g,'\n');
 const env={APPLE_CLIENT_ID:'com.comichuddle.web',APPLE_TEAM_ID:'TEAM123456',APPLE_KEY_ID:'KEY1234567',APPLE_PRIVATE_KEY:pem};
 const now=Date.UTC(2026,10,17),jwt=appleClientSecret(env,now),[h,p,sig]=jwt.split('.');
 const header=JSON.parse(Buffer.from(h,'base64url').toString()),payload=JSON.parse(Buffer.from(p,'base64url').toString());
 assert.deepEqual(header,{alg:'ES256',kid:'KEY1234567',typ:'JWT'});
 assert.deepEqual([payload.iss,payload.sub,payload.aud,payload.exp-payload.iat],['TEAM123456','com.comichuddle.web','https://appleid.apple.com',150*86400]);
 assert.ok(verify('sha256',Buffer.from(h+'.'+p),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url')));
 assert.deepEqual(Object.keys(socialProviders(env)),['apple']);
});
