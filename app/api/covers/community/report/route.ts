import {getChatGPTUser} from '../../../../chatgpt-auth';
import {getDb} from '../../../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../../../lib/api-security';
import {communityCoverReport,reportCommunityCover} from '../../../../../lib/community-covers';
export const runtime='nodejs';export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);

/** "Report image": any signed-in user hides a collector cover until an operator reviews it. */
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json('Sign in to report an image.',401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
 const input=communityCoverReport.safeParse(await readObject(req,2000));if(!input.success)return json('Choose a collector cover photo to report.',400);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'covers:report',10);if(limited)return limited;
 return privateJson(await reportCommunityCover(db,user.userId,input.data));
}catch(error){if(error instanceof ApiRequestError)return json(error.message,error.status);return json('The report could not be sent. Please retry.',500)}}
