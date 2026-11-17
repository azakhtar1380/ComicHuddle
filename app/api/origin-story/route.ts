// Origin story setup data (GET) and "Remind me after my next haul" (POST {action:'snooze'}).
import {getChatGPTUser} from '../../chatgpt-auth';
import {privateJson} from '../../../lib/api-security';
import {originStory,snoozeOriginStory} from '../../../lib/origin-story';

export const dynamic='force-dynamic';
export async function GET(){
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in first.'},401);
 const s=await originStory(user.userId);
 return privateJson({handle:s.handle,steps:s.steps,snoozed:s.snoozed,earned:s.earned});
}
export async function POST(req:Request){
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in first.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const body=await req.json().catch(()=>({})) as {action?:string};
 if(body.action!=='snooze')return privateJson({error:'Unknown action.'},400);
 await snoozeOriginStory(user.userId);return privateJson({snoozed:true});
}
