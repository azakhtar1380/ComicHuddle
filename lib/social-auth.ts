// Sign in with Google and Apple (Better Auth socialProviders). Each provider turns on only when its env vars are set.
// Accounts link by verified email (both providers verify email; Apple "Hide My Email" relay addresses are accepted
// as-is). New social accounts still go through the normal profile setup (there's no profile until they finish it).
import {createPrivateKey,sign} from 'node:crypto';

export type SocialEnv={GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;APPLE_CLIENT_ID?:string;APPLE_TEAM_ID?:string;APPLE_KEY_ID?:string;APPLE_PRIVATE_KEY?:string;APPLE_APP_BUNDLE_IDENTIFIER?:string};
const b64url=(input:Buffer|string)=>Buffer.from(input).toString('base64url');

export function googleEnabled(env:SocialEnv=process.env as SocialEnv){return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)}
export function appleEnabled(env:SocialEnv=process.env as SocialEnv){return !!(env.APPLE_CLIENT_ID&&env.APPLE_TEAM_ID&&env.APPLE_KEY_ID&&env.APPLE_PRIVATE_KEY)}

/** Apple's client secret is a short-lived ES256 JWT signed with the .p8 key (max 6 months; we use 150 days). */
export function appleClientSecret(env:SocialEnv,now=Date.now()){
 const key=createPrivateKey(String(env.APPLE_PRIVATE_KEY).replace(/\n/g,'\n'));
 const iat=Math.floor(now/1000),header={alg:'ES256',kid:env.APPLE_KEY_ID,typ:'JWT'},payload={iss:env.APPLE_TEAM_ID,iat,exp:iat+150*86400,aud:'https://appleid.apple.com',sub:env.APPLE_CLIENT_ID};
 const input=b64url(JSON.stringify(header))+'.'+b64url(JSON.stringify(payload));
 return input+'.'+b64url(sign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'}));
}

export function socialProviders(env:SocialEnv=process.env as SocialEnv){
 return {
  ...(googleEnabled(env)?{google:{clientId:env.GOOGLE_CLIENT_ID!,clientSecret:env.GOOGLE_CLIENT_SECRET!,prompt:'select_account' as const}}:{}),
  ...(appleEnabled(env)?{apple:{clientId:env.APPLE_CLIENT_ID!,clientSecret:appleClientSecret(env),...(env.APPLE_APP_BUNDLE_IDENTIFIER?{appBundleIdentifier:env.APPLE_APP_BUNDLE_IDENTIFIER}:{})}}:{}),
 };
}
