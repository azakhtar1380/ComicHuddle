import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {previewRulesVersion} from '../../../lib/community';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readObject} from '../../../lib/api-security';
import {fetchMetronDirectory,METRON_BOUNDS,MetronDirectoryError,parseMetronRequest} from '../../../lib/metron-directory';

const json=(data:unknown,status=200,headers:Record<string,string>={})=>privateJson(data,status,{'Pragma':'no-cache','X-Content-Type-Options':'nosniff',...headers});
export async function GET(){return json({error:'Use the signed-in Metron connection form.',code:'metron_post_required'},405,{'Allow':'POST'})}

export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in to ComicHuddle first.',code:'signin_required'},401);
 const url=new URL(req.url);
 if(req.headers.get('origin')!==url.origin)return json({error:'Origin rejected.',code:'origin_rejected'},403);
 if(url.search)return json({error:'Metron credentials and searches belong in the protected form.',code:'metron_invalid_request'},400);
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'Send the protected form as JSON.',code:'metron_invalid_request'},415);
 const db=getDb(),[profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 if(!profile)return json({error:'Create your free collector profile first.',code:'profile_required'},403);
 if(profile.moderated||profile.deletionStartedAt||await isRestricted(db,user.userId))return json({error:'This account is unavailable for directory connections.',code:'account_unavailable'},403);
 if(profile.rulesVersion!==previewRulesVersion||!profile.rulesAcceptedAt)return json({error:'Accept the current community rules in your collector profile first.',code:'rules_required'},403);
 const limited=await enforceWriteLimits(db,user.userId,'metron:lookup',METRON_BOUNDS.minuteBudget);
 if(limited)return json({error:'ComicHuddle lookup limit reached. Wait before another Metron request.',code:'metron_app_limit'},429,{'Retry-After':limited.headers.get('Retry-After')||'60'});
 const body=await readObject(req,METRON_BOUNDS.requestBytes),request=parseMetronRequest(body);
 return json(await fetchMetronDirectory(request,{signal:req.signal}));
}catch(error){
 if(error instanceof MetronDirectoryError)return json({error:error.message,code:error.code},error.status,error.retryAfterSeconds?{'Retry-After':String(error.retryAfterSeconds)}:{});
 if(error instanceof ApiRequestError)return json({error:error.message,code:'metron_invalid_request'},error.status);
 return json({error:'The Metron connection is unavailable. Try again later.',code:'metron_unavailable'},503);
}}
