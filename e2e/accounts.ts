// Test accounts used by the end-to-end tests. They exist only on the throwaway local test database.
// The admin email matches COMICHUDDLE_ADMIN_EMAILS in scripts/e2e-server.mjs.
import {createHmac,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';

export const ACCOUNTS={
 admin:{email:'e2e-admin@comichuddle.test',name:'QA Admin',handle:'qa_admin',color:'teal'},
 seller:{email:'e2e-seller@comichuddle.test',name:'QA Seller',handle:'qa_seller',color:'red'},
 buyer:{email:'e2e-buyer@comichuddle.test',name:'QA Buyer',handle:'qa_buyer',color:'blue'},
} as const;
export type Role=keyof typeof ACCOUNTS;
export const authFile=(role:Role)=>'e2e/.auth/'+role+'.json';

/** Per-machine test password: derived from a random local secret (e2e/.auth/secret, git-ignored), never printed. */
export function testPassword(email:string){
 const file='e2e/.auth/secret';
 if(!existsSync(file)){mkdirSync('e2e/.auth',{recursive:true});writeFileSync(file,randomBytes(32).toString('hex'))}
 return 'T'+createHmac('sha256',readFileSync(file,'utf8')).update(email).digest('base64url').slice(0,22)+'!9';
}
