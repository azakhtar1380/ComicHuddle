// Creates the test accounts on the throwaway local database (or signs in, if the test server was reused) and
// saves each one's signed-in browser state in e2e/.auth (git-ignored). Passwords come from a random local secret
// and are never printed. None of these are real people's logins.
import {request,type FullConfig} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {ACCOUNTS,authFile,testPassword,type Role} from './accounts';

async function create(baseURL:string,role:Role){
 const account=ACCOUNTS[role],password=testPassword(account.email);
 // Still signed in from an earlier run on the same test server: keep that session (sign-up/sign-in are rate limited).
 if(existsSync(authFile(role))){const saved=await request.newContext({baseURL,storageState:authFile(role)});const session=await (await saved.get('/api/auth/get-session')).json().catch(()=>null);await saved.dispose();if(session?.user?.email===account.email)return}
 const context=await request.newContext({baseURL,extraHTTPHeaders:{Origin:baseURL}});
 let response=await context.post('/api/auth/sign-up/email',{data:{email:account.email,password,name:account.name}});
 // Already there (a reused test server): sign in instead.
 if(!response.ok())response=await context.post('/api/auth/sign-in/email',{data:{email:account.email,password}});
 if(!response.ok())throw Error(role+' account failed: '+response.status()+' '+(await response.text()).slice(0,200));
 // Collector profile with the current community rules accepted, as the onboarding screen does.
 // The dev server can answer 500 while it compiles a route for the first time: retry a few times.
 for(let attempt=0;attempt<3;attempt++){
 response=await context.post('/api/social',{data:{action:'profile',handle:account.handle,name:account.name,bio:'Automated test account.',tagline:'',location:'Minneapolis, MN',favorite:'',since:2015,color:account.color,featured:[],visible:true,dmOpen:true,accept:true}});
 if(response.ok()||response.status()<500)break;await new Promise(r=>setTimeout(r,2000))}
 if(!response.ok())throw Error(role+' profile failed: '+response.status()+' '+(await response.text()).slice(0,200));
 writeFileSync(authFile(role),JSON.stringify(await context.storageState()));
 await context.dispose();
}

export default async function globalSetup(config:FullConfig){
 const baseURL=config.projects[0].use.baseURL!;
 mkdirSync('e2e/.auth',{recursive:true});
 // The in-memory database only lives as long as the server, so accounts are made fresh every run.
 const probe=await request.newContext({baseURL});
 for(let i=0;i<60;i++){try{if((await probe.get('/api/auth/get-session')).status()<500)break}catch{}await new Promise(r=>setTimeout(r,2000))}
 await probe.dispose();
 for(const role of Object.keys(ACCOUNTS) as Role[]){
  await create(baseURL,role);
 }
}
